use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::http::{header, Method, Request, Response, StatusCode, Uri};
use tauri::{AppHandle, Manager, Runtime, State};

use crate::error::AppError;

const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_PLUGIN_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_VRMA_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_PLUGIN_ID_LEN: usize = 64;
const MAX_ANIMATION_ID_LEN: usize = 128;
const MAX_PERMISSIONS_COUNT: usize = 16;
const MAX_ANIMATIONS_PER_PLUGIN: usize = 64;

const ALLOWED_PERMISSIONS: &[&str] = &[
    "avatar:speak",
    "avatar:interrupt",
    "avatar:expression",
    "avatar:animation",
    "avatar:lookAt",
    "avatar:events",
    "desktop:events",
    "desktop:windowTitle",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAnimationDecl {
    pub id: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub entry: String,
    pub entry_url: String,
    pub permissions: Vec<String>,
    pub animations: Vec<PluginAnimationDecl>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnimationSource {
    User,
    Plugin,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredAnimation {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub source: AnimationSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPluginManifest {
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    description: Option<String>,
    entry: String,
    #[serde(default)]
    permissions: Vec<String>,
    #[serde(default)]
    animations: Vec<PluginAnimationDecl>,
}

#[derive(Debug, Clone)]
struct StoredUserAnimation {
    id: String,
    label: Option<String>,
    canonical_path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct ResolvedPluginAnimation {
    pub id: String,
    pub label: Option<String>,
    pub plugin_id: String,
    pub canonical_path: PathBuf,
}

#[derive(Debug, Default)]
pub struct PluginState {
    user_animations: Mutex<HashMap<String, StoredUserAnimation>>,
}

#[derive(Debug)]
enum ProtocolReject {
    BadRequest(&'static str),
    Forbidden(&'static str),
    NotFound(&'static str),
    PayloadTooLarge(&'static str),
    Internal(&'static str),
}

pub fn validate_plugin_id(id: &str) -> Result<(), AppError> {
    if id.is_empty() || id.len() > MAX_PLUGIN_ID_LEN {
        return Err(AppError::Plugin(
            "Plugin id must be between 1 and 64 characters".to_string(),
        ));
    }
    if id.contains("..") {
        return Err(AppError::Plugin(
            "Plugin id must not contain '..'".to_string(),
        ));
    }
    let bytes = id.as_bytes();
    let is_edge_valid = |b: u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    if !is_edge_valid(bytes[0]) || !is_edge_valid(bytes[bytes.len() - 1]) {
        return Err(AppError::Plugin(
            "Plugin id must start and end with lowercase ASCII alphanumeric characters".to_string(),
        ));
    }
    if !bytes
        .iter()
        .all(|&b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b'_' | b'.'))
    {
        return Err(AppError::Plugin(
            "Plugin id contains invalid characters".to_string(),
        ));
    }
    Ok(())
}

pub fn validate_animation_id(id: &str) -> Result<(), AppError> {
    if id.is_empty() || id.len() > MAX_ANIMATION_ID_LEN {
        return Err(AppError::Plugin(
            "Animation id must be between 1 and 128 characters".to_string(),
        ));
    }
    if id == "." || id == ".." || id.contains("..") {
        return Err(AppError::Plugin(
            "Animation id must not contain path traversal".to_string(),
        ));
    }
    let bytes = id.as_bytes();
    if !bytes[0].is_ascii_alphanumeric() {
        return Err(AppError::Plugin(
            "Animation id must start with an ASCII alphanumeric character".to_string(),
        ));
    }
    if !bytes
        .iter()
        .all(|&b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'))
    {
        return Err(AppError::Plugin(
            "Animation id contains invalid characters".to_string(),
        ));
    }
    Ok(())
}

fn validate_bounded_text(
    value: &str,
    field: &str,
    max_len: usize,
    allow_newlines: bool,
) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Plugin(format!("{field} must not be empty")));
    }
    if trimmed.len() > max_len {
        return Err(AppError::Plugin(format!(
            "{field} exceeds maximum length of {max_len}"
        )));
    }
    if trimmed.chars().any(|c| {
        if allow_newlines && (c == '\n' || c == '\r' || c == '\t') {
            false
        } else {
            c.is_control()
        }
    }) {
        return Err(AppError::Plugin(format!(
            "{field} contains forbidden control characters"
        )));
    }
    Ok(trimmed.to_string())
}

fn validate_relative_subpath(raw: &str) -> Result<Vec<String>, ProtocolReject> {
    if raw.is_empty() {
        return Err(ProtocolReject::NotFound("Empty plugin path"));
    }
    if raw.contains('\0') || raw.contains('\\') || raw.contains(':') || raw.starts_with('/') {
        return Err(ProtocolReject::Forbidden("Invalid relative plugin path"));
    }
    let mut segments = Vec::new();
    for seg in raw.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." {
            return Err(ProtocolReject::Forbidden("Path traversal is not allowed"));
        }
        segments.push(seg.to_string());
    }
    if segments.is_empty() {
        return Err(ProtocolReject::NotFound("Empty plugin path"));
    }
    Ok(segments)
}

fn percent_decode_uri_path(raw: &str) -> Result<String, ProtocolReject> {
    if raw.contains('\0') {
        return Err(ProtocolReject::BadRequest("Null byte in URI path"));
    }
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err(ProtocolReject::BadRequest("Malformed percent-encoding"));
            }
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3])
                .map_err(|_| ProtocolReject::BadRequest("Invalid UTF-8 in percent-encoding"))?;
            let val = u8::from_str_radix(hex, 16)
                .map_err(|_| ProtocolReject::BadRequest("Invalid hex in percent-encoding"))?;
            if val == 0 {
                return Err(ProtocolReject::BadRequest("Null byte in URI path"));
            }
            out.push(val);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| ProtocolReject::BadRequest("Invalid UTF-8 in URI path"))
}

fn has_ascii_extension(path: &Path, expected_exts: &[&str]) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            expected_exts
                .iter()
                .any(|cand| ext.eq_ignore_ascii_case(cand))
        })
}

fn canonicalize_plugin_root(
    plugins_dir: &Path,
    plugin_id: &str,
) -> Result<PathBuf, ProtocolReject> {
    validate_plugin_id(plugin_id)
        .map_err(|_| ProtocolReject::BadRequest("Invalid plugin identifier"))?;

    let canonical_plugins_dir = fs::canonicalize(plugins_dir)
        .map_err(|_| ProtocolReject::NotFound("Plugins directory does not exist"))?;
    let plugin_dir = canonical_plugins_dir.join(plugin_id);
    let canonical_plugin_root = fs::canonicalize(&plugin_dir)
        .map_err(|_| ProtocolReject::NotFound("Plugin directory does not exist"))?;

    if !canonical_plugin_root.starts_with(&canonical_plugins_dir)
        || canonical_plugin_root == canonical_plugins_dir
        || !canonical_plugin_root.is_dir()
    {
        return Err(ProtocolReject::Forbidden(
            "Plugin root escapes plugins directory",
        ));
    }
    Ok(canonical_plugin_root)
}

fn resolve_file_strictly_inside(
    canonical_plugin_root: &Path,
    segments: &[String],
) -> Result<PathBuf, ProtocolReject> {
    let mut candidate = canonical_plugin_root.to_path_buf();
    for seg in segments {
        candidate.push(seg);
    }

    let canonical_file = match fs::canonicalize(&candidate) {
        Ok(p) => p,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(ProtocolReject::NotFound("Requested plugin file not found"));
        }
        Err(_) => {
            return Err(ProtocolReject::Forbidden(
                "Failed to resolve plugin file path",
            ));
        }
    };

    if !canonical_file.starts_with(canonical_plugin_root) || canonical_file == canonical_plugin_root
    {
        return Err(ProtocolReject::Forbidden(
            "Path escapes plugin root directory",
        ));
    }
    if !canonical_file.is_file() {
        return Err(ProtocolReject::NotFound(
            "Plugin target is not a regular file",
        ));
    }
    Ok(canonical_file)
}

pub fn resolve_plugin_file(
    plugins_dir: &Path,
    plugin_id: &str,
    raw_uri_path: &str,
) -> Result<PathBuf, AppError> {
    let decoded =
        percent_decode_uri_path(raw_uri_path).map_err(|e| AppError::Plugin(format!("{e:?}")))?;
    let stripped = decoded.strip_prefix('/').unwrap_or(&decoded);
    let segments =
        validate_relative_subpath(stripped).map_err(|e| AppError::Plugin(format!("{e:?}")))?;
    let canonical_plugin_root = canonicalize_plugin_root(plugins_dir, plugin_id)
        .map_err(|e| AppError::Plugin(format!("{e:?}")))?;
    resolve_file_strictly_inside(&canonical_plugin_root, &segments)
        .map_err(|e| AppError::Plugin(format!("{e:?}")))
}

fn validate_manifest_permissions(raw_perms: &[String]) -> Result<Vec<String>, AppError> {
    if raw_perms.len() > MAX_PERMISSIONS_COUNT {
        return Err(AppError::Plugin(
            "Manifest declares too many permissions".to_string(),
        ));
    }
    let mut seen = HashSet::new();
    let mut validated = Vec::new();
    for perm in raw_perms {
        if !ALLOWED_PERMISSIONS.contains(&perm.as_str()) {
            return Err(AppError::Plugin(format!(
                "Unknown plugin permission: {perm}"
            )));
        }
        if seen.insert(perm.clone()) {
            validated.push(perm.clone());
        }
    }
    Ok(validated)
}

pub fn load_plugin_from_dir(
    plugins_dir: &Path,
    dir_name: &str,
) -> Result<(PluginInfo, Vec<ResolvedPluginAnimation>), AppError> {
    validate_plugin_id(dir_name)?;
    let canonical_plugin_root = canonicalize_plugin_root(plugins_dir, dir_name)
        .map_err(|e| AppError::Plugin(format!("Invalid plugin root for '{dir_name}': {e:?}")))?;

    let manifest_segments = vec!["manifest.json".to_string()];
    let canonical_manifest =
        resolve_file_strictly_inside(&canonical_plugin_root, &manifest_segments).map_err(|e| {
            AppError::Plugin(format!("Invalid manifest.json for '{dir_name}': {e:?}"))
        })?;

    let meta = fs::metadata(&canonical_manifest).map_err(|e| {
        AppError::Plugin(format!("Cannot stat manifest.json for '{dir_name}': {e}"))
    })?;
    if meta.len() > MAX_MANIFEST_BYTES {
        return Err(AppError::Plugin(format!(
            "manifest.json for '{dir_name}' exceeds maximum size"
        )));
    }

    let raw_bytes = fs::read(&canonical_manifest).map_err(|e| {
        AppError::Plugin(format!("Cannot read manifest.json for '{dir_name}': {e}"))
    })?;
    let raw: RawPluginManifest = serde_json::from_slice(&raw_bytes)
        .map_err(|e| AppError::Plugin(format!("Invalid manifest.json for '{dir_name}': {e}")))?;

    validate_plugin_id(&raw.id)?;
    if raw.id != dir_name {
        return Err(AppError::Plugin(format!(
            "Plugin id '{}' does not match directory '{}'",
            raw.id, dir_name
        )));
    }

    let name = validate_bounded_text(&raw.name, "manifest.name", 128, false)?;
    let version = validate_bounded_text(&raw.version, "manifest.version", 64, false)?;
    let description = match raw.description {
        Some(desc) => Some(validate_bounded_text(
            &desc,
            "manifest.description",
            500,
            true,
        )?),
        None => None,
    };

    if raw.entry.contains('?') || raw.entry.contains('#') {
        return Err(AppError::Plugin(
            "manifest.entry must not contain query or fragment".to_string(),
        ));
    }
    let entry_segments = validate_relative_subpath(&raw.entry)
        .map_err(|_| AppError::Plugin(format!("Invalid manifest.entry path '{}'", raw.entry)))?;
    let entry_file = resolve_file_strictly_inside(&canonical_plugin_root, &entry_segments)
        .map_err(|_| {
            AppError::Plugin(format!(
                "manifest.entry '{}' does not resolve inside plugin directory",
                raw.entry
            ))
        })?;
    if !has_ascii_extension(&entry_file, &["html", "htm"]) {
        return Err(AppError::Plugin(
            "manifest.entry must point to an .html or .htm file".to_string(),
        ));
    }

    let permissions = validate_manifest_permissions(&raw.permissions)?;
    if raw.animations.len() > MAX_ANIMATIONS_PER_PLUGIN {
        return Err(AppError::Plugin(
            "Manifest declares too many animations".to_string(),
        ));
    }

    let mut seen_anim_ids = HashSet::new();
    let mut anim_decls = Vec::with_capacity(raw.animations.len());
    let mut resolved_anims = Vec::with_capacity(raw.animations.len());

    for anim in &raw.animations {
        validate_animation_id(&anim.id)?;
        if !seen_anim_ids.insert(anim.id.clone()) {
            return Err(AppError::Plugin(format!(
                "Duplicate animation id '{}' in manifest '{}'",
                anim.id, raw.id
            )));
        }
        let label = match &anim.label {
            Some(l) => Some(validate_bounded_text(l, "animation.label", 128, false)?),
            None => None,
        };
        let anim_segments = validate_relative_subpath(&anim.path)
            .map_err(|_| AppError::Plugin(format!("Invalid animation path '{}'", anim.path)))?;
        let anim_file = resolve_file_strictly_inside(&canonical_plugin_root, &anim_segments)
            .map_err(|_| {
                AppError::Plugin(format!(
                    "Animation path '{}' does not resolve inside plugin directory",
                    anim.path
                ))
            })?;
        if !has_ascii_extension(&anim_file, &["vrma"]) {
            return Err(AppError::Plugin(format!(
                "Animation '{}' must point to a .vrma file",
                anim.id
            )));
        }
        let normalized_anim_path = anim_segments.join("/");
        anim_decls.push(PluginAnimationDecl {
            id: anim.id.clone(),
            path: normalized_anim_path,
            label: label.clone(),
        });
        resolved_anims.push(ResolvedPluginAnimation {
            id: anim.id.clone(),
            label,
            plugin_id: raw.id.clone(),
            canonical_path: anim_file,
        });
    }

    let normalized_entry = entry_segments.join("/");
    let entry_url = format!("plugin://{}/{}", raw.id, normalized_entry);

    Ok((
        PluginInfo {
            id: raw.id,
            name,
            version,
            description,
            entry: normalized_entry,
            entry_url,
            permissions,
            animations: anim_decls,
        },
        resolved_anims,
    ))
}

pub fn discover_plugins_in_dir(
    plugins_dir: &Path,
) -> Result<(Vec<PluginInfo>, Vec<ResolvedPluginAnimation>), AppError> {
    if !plugins_dir.exists() {
        return Ok((Vec::new(), Vec::new()));
    }
    let entries = fs::read_dir(plugins_dir)
        .map_err(|e| AppError::Plugin(format!("Failed to read plugins directory: {e}")))?;

    let mut dir_names = Vec::new();
    for entry_res in entries {
        let Ok(entry) = entry_res else {
            continue;
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str() {
            if !name.starts_with('.') {
                dir_names.push(name.to_string());
            }
        }
    }
    dir_names.sort();

    let mut plugins = Vec::new();
    let mut animations = Vec::new();
    let mut seen_anim_ids = HashSet::new();

    for dir_name in dir_names {
        match load_plugin_from_dir(plugins_dir, &dir_name) {
            Ok((info, plugin_anims)) => {
                plugins.push(info);
                for anim in plugin_anims {
                    if seen_anim_ids.insert(anim.id.clone()) {
                        animations.push(anim);
                    } else {
                        log::warn!(
                            "Skipping duplicate plugin animation id '{}' from plugin '{}'",
                            anim.id,
                            anim.plugin_id
                        );
                    }
                }
            }
            Err(err) => {
                log::warn!("Skipping invalid plugin '{dir_name}': {err}");
            }
        }
    }

    Ok((plugins, animations))
}

pub fn register_user_animation_with_base(
    state: &PluginState,
    id: &str,
    path: &str,
    label: Option<String>,
    allowed_base_dir: Option<&Path>,
) -> Result<RegisteredAnimation, AppError> {
    validate_animation_id(id)?;

    if path.trim().is_empty() || path.contains('\0') {
        return Err(AppError::Plugin(
            "Animation file path must not be empty or contain null bytes".to_string(),
        ));
    }
    let raw_path = Path::new(path);
    if raw_path
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(AppError::Plugin(
            "Animation file path must not contain '..'".to_string(),
        ));
    }
    if !has_ascii_extension(raw_path, &["vrma"]) {
        return Err(AppError::Plugin(
            "Animation file path must have a .vrma extension".to_string(),
        ));
    }

    let canonical_path = fs::canonicalize(raw_path)
        .map_err(|e| AppError::Plugin(format!("Failed to resolve animation file '{path}': {e}")))?;

    if let Some(base_dir) = allowed_base_dir {
        let canonical_base = fs::canonicalize(base_dir).map_err(|e| {
            AppError::Plugin(format!("Failed to resolve base animation directory: {e}"))
        })?;
        if !canonical_path.starts_with(&canonical_base) || canonical_path == canonical_base {
            return Err(AppError::Plugin(
                "Animation path escapes allowed base directory".to_string(),
            ));
        }
    }

    if !canonical_path.is_file() || !has_ascii_extension(&canonical_path, &["vrma"]) {
        return Err(AppError::Plugin(
            "Resolved animation target must be a regular .vrma file".to_string(),
        ));
    }

    let meta = fs::metadata(&canonical_path)
        .map_err(|e| AppError::Plugin(format!("Failed to stat animation file: {e}")))?;
    if meta.len() > MAX_VRMA_FILE_BYTES {
        return Err(AppError::Plugin(
            "Animation file exceeds maximum allowed size".to_string(),
        ));
    }

    let validated_label = match label {
        Some(l) => Some(validate_bounded_text(&l, "label", 128, false)?),
        None => None,
    };

    let entry = StoredUserAnimation {
        id: id.to_string(),
        label: validated_label.clone(),
        canonical_path,
    };

    let mut guard = state
        .user_animations
        .lock()
        .map_err(|_| AppError::Plugin("Animation registry lock poisoned".to_string()))?;
    guard.insert(id.to_string(), entry);

    Ok(RegisteredAnimation {
        id: id.to_string(),
        label: validated_label,
        source: AnimationSource::User,
        plugin_id: None,
    })
}

pub fn unregister_user_animation(state: &PluginState, id: &str) -> Result<bool, AppError> {
    validate_animation_id(id)?;
    let mut guard = state
        .user_animations
        .lock()
        .map_err(|_| AppError::Plugin("Animation registry lock poisoned".to_string()))?;
    Ok(guard.remove(id).is_some())
}

pub fn list_animations_with_plugins_dir(
    state: &PluginState,
    plugins_dir: Option<&Path>,
) -> Result<Vec<RegisteredAnimation>, AppError> {
    let mut by_id: HashMap<String, RegisteredAnimation> = HashMap::new();

    if let Some(dir) = plugins_dir {
        let (_, plugin_anims) = discover_plugins_in_dir(dir)?;
        for anim in plugin_anims {
            by_id.insert(
                anim.id.clone(),
                RegisteredAnimation {
                    id: anim.id,
                    label: anim.label,
                    source: AnimationSource::Plugin,
                    plugin_id: Some(anim.plugin_id),
                },
            );
        }
    }

    let guard = state
        .user_animations
        .lock()
        .map_err(|_| AppError::Plugin("Animation registry lock poisoned".to_string()))?;
    for anim in guard.values() {
        by_id.insert(
            anim.id.clone(),
            RegisteredAnimation {
                id: anim.id.clone(),
                label: anim.label.clone(),
                source: AnimationSource::User,
                plugin_id: None,
            },
        );
    }

    let mut result: Vec<RegisteredAnimation> = by_id.into_values().collect();
    result.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(result)
}

pub fn read_registered_animation_bytes_in_dir(
    state: &PluginState,
    plugins_dir: Option<&Path>,
    id: &str,
) -> Result<Vec<u8>, AppError> {
    validate_animation_id(id)?;

    let user_path = {
        let guard = state
            .user_animations
            .lock()
            .map_err(|_| AppError::Plugin("Animation registry lock poisoned".to_string()))?;
        guard.get(id).map(|entry| entry.canonical_path.clone())
    };

    let target_path = if let Some(path) = user_path {
        let canonical = fs::canonicalize(&path).map_err(|e| {
            AppError::Plugin(format!("Registered animation '{id}' is unavailable: {e}"))
        })?;
        if !canonical.is_file() || !has_ascii_extension(&canonical, &["vrma"]) {
            return Err(AppError::Plugin(format!(
                "Registered animation '{id}' is no longer a valid .vrma file"
            )));
        }
        canonical
    } else if let Some(dir) = plugins_dir {
        let (_, plugin_anims) = discover_plugins_in_dir(dir)?;
        let found = plugin_anims
            .into_iter()
            .find(|anim| anim.id == id)
            .ok_or_else(|| AppError::Plugin(format!("Unknown animation id: {id}")))?;
        let canonical_plugin_root = canonicalize_plugin_root(dir, &found.plugin_id)
            .map_err(|e| AppError::Plugin(format!("Invalid plugin root: {e:?}")))?;
        let canonical = fs::canonicalize(&found.canonical_path).map_err(|e| {
            AppError::Plugin(format!("Plugin animation '{id}' is unavailable: {e}"))
        })?;
        if !canonical.starts_with(&canonical_plugin_root)
            || !canonical.is_file()
            || !has_ascii_extension(&canonical, &["vrma"])
        {
            return Err(AppError::Plugin(format!(
                "Plugin animation '{id}' escaped plugin directory"
            )));
        }
        canonical
    } else {
        return Err(AppError::Plugin(format!("Unknown animation id: {id}")));
    };

    let meta = fs::metadata(&target_path)
        .map_err(|e| AppError::Plugin(format!("Failed to stat animation '{id}': {e}")))?;
    if meta.len() > MAX_VRMA_FILE_BYTES {
        return Err(AppError::Plugin(format!(
            "Animation '{id}' exceeds maximum allowed size"
        )));
    }

    fs::read(&target_path)
        .map_err(|e| AppError::Plugin(format!("Failed to read animation '{id}': {e}")))
}

fn mime_type_for_path(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match ext.as_deref() {
        Some("html") | Some("htm") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("wasm") => "application/wasm",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

pub fn build_plugin_csp(plugin_id: &str) -> String {
    format!(
        "default-src 'none'; script-src plugin://{plugin_id}; worker-src 'none'; connect-src 'none'"
    )
}

fn build_http_response(
    status: StatusCode,
    content_type: &str,
    csp: Option<&str>,
    body: Vec<u8>,
) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff");
    if let Some(policy) = csp {
        builder = builder.header(header::CONTENT_SECURITY_POLICY, policy);
    }
    builder.body(body).unwrap_or_else(|_| {
        let mut fallback = Response::new(Vec::new());
        *fallback.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
        fallback
    })
}

fn reject_to_response(reject: ProtocolReject) -> Response<Vec<u8>> {
    let (status, msg) = match reject {
        ProtocolReject::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
        ProtocolReject::Forbidden(m) => (StatusCode::FORBIDDEN, m),
        ProtocolReject::NotFound(m) => (StatusCode::NOT_FOUND, m),
        ProtocolReject::PayloadTooLarge(m) => (StatusCode::PAYLOAD_TOO_LARGE, m),
        ProtocolReject::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, m),
    };
    build_http_response(
        status,
        "text/plain; charset=utf-8",
        None,
        msg.as_bytes().to_vec(),
    )
}

pub fn serve_plugin_request(
    plugins_dir: Option<&Path>,
    uri: &Uri,
    is_head: bool,
) -> Response<Vec<u8>> {
    if uri.scheme_str() != Some("plugin") {
        return reject_to_response(ProtocolReject::BadRequest("Invalid URI scheme"));
    }
    if uri.port().is_some() {
        return reject_to_response(ProtocolReject::BadRequest(
            "Port is not allowed in plugin URI",
        ));
    }
    let Some(authority) = uri.authority() else {
        return reject_to_response(ProtocolReject::BadRequest("Missing plugin id"));
    };
    if authority.as_str().contains('@') || authority.as_str().contains(':') {
        return reject_to_response(ProtocolReject::BadRequest("Invalid plugin authority"));
    }
    let plugin_id = authority.host();
    if validate_plugin_id(plugin_id).is_err() {
        return reject_to_response(ProtocolReject::BadRequest("Invalid plugin id"));
    }

    let Some(dir) = plugins_dir else {
        return reject_to_response(ProtocolReject::NotFound("Plugins directory unavailable"));
    };

    let decoded_path = match percent_decode_uri_path(uri.path()) {
        Ok(p) => p,
        Err(rej) => return reject_to_response(rej),
    };
    let stripped = decoded_path.strip_prefix('/').unwrap_or(&decoded_path);
    let segments = match validate_relative_subpath(stripped) {
        Ok(s) => s,
        Err(rej) => return reject_to_response(rej),
    };
    let canonical_root = match canonicalize_plugin_root(dir, plugin_id) {
        Ok(r) => r,
        Err(rej) => return reject_to_response(rej),
    };
    let canonical_file = match resolve_file_strictly_inside(&canonical_root, &segments) {
        Ok(f) => f,
        Err(rej) => return reject_to_response(rej),
    };

    let meta = match fs::metadata(&canonical_file) {
        Ok(m) => m,
        Err(_) => {
            return reject_to_response(ProtocolReject::Internal("Failed to read file metadata"));
        }
    };
    if meta.len() > MAX_PLUGIN_FILE_BYTES {
        return reject_to_response(ProtocolReject::PayloadTooLarge("Plugin file too large"));
    }

    let body = if is_head {
        Vec::new()
    } else {
        match fs::read(&canonical_file) {
            Ok(bytes) => bytes,
            Err(_) => {
                return reject_to_response(ProtocolReject::Internal("Failed to read plugin file"));
            }
        }
    };

    let content_type = mime_type_for_path(&canonical_file);
    let csp = build_plugin_csp(plugin_id);
    build_http_response(StatusCode::OK, content_type, Some(&csp), body)
}

pub fn handle_plugin_protocol<R: Runtime>(
    app: &AppHandle<R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let method = request.method();
    if method != Method::GET && method != Method::HEAD {
        return build_http_response(
            StatusCode::METHOD_NOT_ALLOWED,
            "text/plain; charset=utf-8",
            None,
            b"Method not allowed".to_vec(),
        );
    }
    let plugins_dir = app.path().app_data_dir().ok().map(|d| d.join("plugins"));
    serve_plugin_request(
        plugins_dir.as_deref(),
        request.uri(),
        method == Method::HEAD,
    )
}

fn plugins_dir_from_app<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("plugins"))
        .map_err(|e| AppError::Plugin(format!("Failed to resolve app data dir: {e}")))
}

#[tauri::command]
pub fn list_plugins(app: AppHandle) -> Result<Vec<PluginInfo>, AppError> {
    let plugins_dir = plugins_dir_from_app(&app)?;
    let (plugins, _) = discover_plugins_in_dir(&plugins_dir)?;
    Ok(plugins)
}

#[tauri::command]
pub fn list_registered_animations(
    app: AppHandle,
    state: State<'_, PluginState>,
) -> Result<Vec<RegisteredAnimation>, AppError> {
    let plugins_dir = plugins_dir_from_app(&app).ok();
    list_animations_with_plugins_dir(&state, plugins_dir.as_deref())
}

#[tauri::command]
pub fn register_animation(
    state: State<'_, PluginState>,
    id: String,
    path: String,
    label: Option<String>,
) -> Result<RegisteredAnimation, AppError> {
    register_user_animation_with_base(&state, &id, &path, label, None)
}

#[tauri::command]
pub fn unregister_animation(state: State<'_, PluginState>, id: String) -> Result<bool, AppError> {
    unregister_user_animation(&state, &id)
}

#[tauri::command]
pub fn read_registered_animation_bytes(
    app: AppHandle,
    state: State<'_, PluginState>,
    id: String,
) -> Result<tauri::ipc::Response, AppError> {
    let plugins_dir = plugins_dir_from_app(&app).ok();
    let bytes = read_registered_animation_bytes_in_dir(&state, plugins_dir.as_deref(), &id)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(prefix: &str) -> Self {
            let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "deskumi_plugins_test_{prefix}_{}_{}",
                std::process::id(),
                seq
            ));
            fs::create_dir_all(&dir).expect("failed to create test temp dir");
            Self { path: dir }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn write_file(path: &Path, content: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("failed to create parent dirs");
        }
        fs::write(path, content).expect("failed to write test file");
    }

    fn create_valid_plugin(plugins_dir: &Path, id: &str) {
        let root = plugins_dir.join(id);
        write_file(
            &root.join("index.html"),
            b"<html><script src=\"main.js\"></script></html>",
        );
        write_file(&root.join("main.js"), b"console.log('ok');");
        write_file(&root.join("animations/wave.vrma"), b"VRMA_BYTES");
        let manifest = serde_json::json!({
            "id": id,
            "name": "Hello Companion",
            "version": "1.0.0",
            "description": "Sample plugin",
            "entry": "index.html",
            "permissions": ["avatar:expression", "avatar:animation"],
            "animations": [
                { "id": "wave", "path": "animations/wave.vrma", "label": "Wave" }
            ]
        });
        write_file(
            &root.join("manifest.json"),
            serde_json::to_vec_pretty(&manifest)
                .expect("json")
                .as_slice(),
        );
    }

    #[test]
    fn test_serves_valid_plugin_files_with_strict_csp_and_mime() {
        let tmp = TestDir::new("serve_valid");
        let plugins_dir = tmp.path.join("plugins");
        create_valid_plugin(&plugins_dir, "hello-companion");

        let html_uri: Uri = "plugin://hello-companion/index.html".parse().expect("uri");
        let resp = serve_plugin_request(Some(&plugins_dir), &html_uri, false);
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok()),
            Some("text/html; charset=utf-8")
        );
        assert_eq!(
            resp.headers()
                .get(header::CONTENT_SECURITY_POLICY)
                .and_then(|v| v.to_str().ok()),
            Some("default-src 'none'; script-src plugin://hello-companion; worker-src 'none'; connect-src 'none'")
        );
        assert_eq!(
            resp.headers()
                .get("X-Content-Type-Options")
                .and_then(|v| v.to_str().ok()),
            Some("nosniff")
        );
        assert!(!resp.body().is_empty());

        let js_uri: Uri = "plugin://hello-companion/main.js".parse().expect("uri");
        let js_resp = serve_plugin_request(Some(&plugins_dir), &js_uri, false);
        assert_eq!(js_resp.status(), StatusCode::OK);
        assert_eq!(
            js_resp
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok()),
            Some("text/javascript; charset=utf-8")
        );

        let head_resp = serve_plugin_request(Some(&plugins_dir), &js_uri, true);
        assert_eq!(head_resp.status(), StatusCode::OK);
        assert!(head_resp.body().is_empty());
    }

    #[test]
    fn test_rejects_path_traversal_and_malformed_uris() {
        let tmp = TestDir::new("traversal");
        let plugins_dir = tmp.path.join("plugins");
        create_valid_plugin(&plugins_dir, "hello-companion");
        write_file(&tmp.path.join("secret.txt"), b"TOP_SECRET");

        let cases = [
            "plugin://hello-companion/../secret.txt",
            "plugin://hello-companion/%2e%2e/secret.txt",
            "plugin://hello-companion/animations/..%2f..%2fsecret.txt",
            "plugin://hello-companion/./index.html",
            "plugin://hello-companion/main%00.js",
            "plugin://hello-companion/sub%5cmain.js",
            "plugin://hello-companion/C:/secret.txt",
            "plugin://bad..id/index.html",
            "plugin://hello-companion:8080/index.html",
        ];

        for raw in cases {
            let uri: Uri = raw.parse().expect("valid test uri syntax");
            let resp = serve_plugin_request(Some(&plugins_dir), &uri, false);
            assert!(
                resp.status().is_client_error(),
                "expected 4xx for traversal URI '{raw}', got {}",
                resp.status()
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn test_rejects_symlink_escapes_in_plugin_protocol() {
        use std::os::unix::fs::symlink;

        let tmp = TestDir::new("symlink_uri");
        let plugins_dir = tmp.path.join("plugins");
        create_valid_plugin(&plugins_dir, "hello-companion");
        let outside_secret = tmp.path.join("outside_secret.js");
        write_file(&outside_secret, b"alert('pwned');");

        let outside_dir = tmp.path.join("outside_dir");
        write_file(&outside_dir.join("leak.js"), b"leak");

        // File symlink escaping plugin root
        symlink(
            &outside_secret,
            plugins_dir.join("hello-companion/escape.js"),
        )
        .expect("symlink file");
        let uri_file: Uri = "plugin://hello-companion/escape.js".parse().expect("uri");
        assert_eq!(
            serve_plugin_request(Some(&plugins_dir), &uri_file, false).status(),
            StatusCode::FORBIDDEN
        );

        // Directory symlink escaping plugin root
        symlink(&outside_dir, plugins_dir.join("hello-companion/ext")).expect("symlink dir");
        let uri_dir: Uri = "plugin://hello-companion/ext/leak.js".parse().expect("uri");
        assert_eq!(
            serve_plugin_request(Some(&plugins_dir), &uri_dir, false).status(),
            StatusCode::FORBIDDEN
        );

        // Plugin root directory itself escaping plugins_dir
        symlink(&outside_dir, plugins_dir.join("evil-link")).expect("symlink plugin root");
        let uri_root: Uri = "plugin://evil-link/leak.js".parse().expect("uri");
        assert_eq!(
            serve_plugin_request(Some(&plugins_dir), &uri_root, false).status(),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn test_manifest_validation_and_discovery() {
        let tmp = TestDir::new("manifest");
        let plugins_dir = tmp.path.join("plugins");
        create_valid_plugin(&plugins_dir, "alpha-plugin");

        // Invalid: mismatched id
        let bad_id_dir = plugins_dir.join("bad-id");
        write_file(&bad_id_dir.join("index.html"), b"<html></html>");
        write_file(
            &bad_id_dir.join("manifest.json"),
            br#"{"id":"other-id","name":"Bad","version":"1.0","entry":"index.html"}"#,
        );
        assert!(load_plugin_from_dir(&plugins_dir, "bad-id").is_err());

        // Invalid: traversal in entry
        let bad_entry_dir = plugins_dir.join("bad-entry");
        write_file(&tmp.path.join("outside.html"), b"<html></html>");
        write_file(
            &bad_entry_dir.join("manifest.json"),
            br#"{"id":"bad-entry","name":"Bad","version":"1.0","entry":"../outside.html"}"#,
        );
        assert!(load_plugin_from_dir(&plugins_dir, "bad-entry").is_err());

        // Invalid: unknown permission
        let bad_perm_dir = plugins_dir.join("bad-perm");
        write_file(&bad_perm_dir.join("index.html"), b"<html></html>");
        write_file(
            &bad_perm_dir.join("manifest.json"),
            br#"{"id":"bad-perm","name":"Bad","version":"1.0","entry":"index.html","permissions":["fs:read"]}"#,
        );
        assert!(load_plugin_from_dir(&plugins_dir, "bad-perm").is_err());

        // Invalid: non-vrma animation
        let bad_anim_dir = plugins_dir.join("bad-anim");
        write_file(&bad_anim_dir.join("index.html"), b"<html></html>");
        write_file(&bad_anim_dir.join("anim.txt"), b"not vrma");
        write_file(
            &bad_anim_dir.join("manifest.json"),
            br#"{"id":"bad-anim","name":"Bad","version":"1.0","entry":"index.html","animations":[{"id":"wave","path":"anim.txt"}]}"#,
        );
        assert!(load_plugin_from_dir(&plugins_dir, "bad-anim").is_err());

        // Discovery skips broken plugins and returns valid ones
        let (plugins, anims) = discover_plugins_in_dir(&plugins_dir).expect("discover");
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].id, "alpha-plugin");
        assert_eq!(plugins[0].entry_url, "plugin://alpha-plugin/index.html");
        assert_eq!(anims.len(), 1);
        assert_eq!(anims[0].id, "wave");
    }

    #[cfg(unix)]
    #[test]
    fn test_manifest_rejects_symlink_escape_for_entry_and_animation() {
        use std::os::unix::fs::symlink;

        let tmp = TestDir::new("manifest_symlink");
        let plugins_dir = tmp.path.join("plugins");
        let outside_vrma = tmp.path.join("outside.vrma");
        write_file(&outside_vrma, b"OUTSIDE");

        let p = plugins_dir.join("sym-anim");
        write_file(&p.join("index.html"), b"<html></html>");
        symlink(&outside_vrma, p.join("escape.vrma")).expect("symlink");
        write_file(
            &p.join("manifest.json"),
            br#"{"id":"sym-anim","name":"Sym","version":"1.0","entry":"index.html","animations":[{"id":"x","path":"escape.vrma"}]}"#,
        );
        assert!(load_plugin_from_dir(&plugins_dir, "sym-anim").is_err());
    }

    #[test]
    fn test_animation_registry_validation_and_bytes_without_path_leak() {
        let tmp = TestDir::new("anim_reg");
        let plugins_dir = tmp.path.join("plugins");
        create_valid_plugin(&plugins_dir, "hello-companion");

        let user_dir = tmp.path.join("user_anims");
        let user_vrma = user_dir.join("custom.vrma");
        write_file(&user_vrma, b"CUSTOM_VRMA_DATA");
        let user_txt = user_dir.join("secret.txt");
        write_file(&user_txt, b"SECRET");

        let state = PluginState::default();

        // Reject invalid IDs
        assert!(register_user_animation_with_base(
            &state,
            "../evil",
            user_vrma.to_str().unwrap(),
            None,
            Some(&user_dir)
        )
        .is_err());
        assert!(register_user_animation_with_base(
            &state,
            "a/b",
            user_vrma.to_str().unwrap(),
            None,
            Some(&user_dir)
        )
        .is_err());

        // Reject path traversal & non-vrma paths
        let traversal_path = format!("{}/../user_anims/custom.vrma", user_dir.display());
        assert!(register_user_animation_with_base(
            &state,
            "custom",
            &traversal_path,
            None,
            Some(&user_dir)
        )
        .is_err());
        assert!(register_user_animation_with_base(
            &state,
            "secret",
            user_txt.to_str().unwrap(),
            None,
            Some(&user_dir)
        )
        .is_err());

        // Register valid user animation
        let reg = register_user_animation_with_base(
            &state,
            "user:custom",
            user_vrma.to_str().unwrap(),
            Some("Custom Dance".to_string()),
            Some(&user_dir),
        )
        .expect("register valid user animation");
        assert_eq!(reg.id, "user:custom");
        assert_eq!(reg.source, AnimationSource::User);

        // List registered animations and verify no filesystem path is exposed
        let list = list_animations_with_plugins_dir(&state, Some(&plugins_dir)).expect("list");
        assert_eq!(list.len(), 2);
        let serialized = serde_json::to_string(&list).expect("serialize");
        assert!(!serialized.contains(&tmp.path.display().to_string()));
        assert!(!serialized.contains("animations/wave.vrma"));

        // Read bytes for both user and plugin animations
        assert_eq!(
            read_registered_animation_bytes_in_dir(&state, Some(&plugins_dir), "user:custom")
                .expect("read user bytes"),
            b"CUSTOM_VRMA_DATA"
        );
        assert_eq!(
            read_registered_animation_bytes_in_dir(&state, Some(&plugins_dir), "wave")
                .expect("read plugin bytes"),
            b"VRMA_BYTES"
        );

        // Reject unknown IDs
        assert!(
            read_registered_animation_bytes_in_dir(&state, Some(&plugins_dir), "unknown").is_err()
        );

        // Unregister removes user animation
        assert!(unregister_user_animation(&state, "user:custom").expect("unregister"));
        assert!(!unregister_user_animation(&state, "user:custom").expect("unregister again"));
        assert!(
            read_registered_animation_bytes_in_dir(&state, Some(&plugins_dir), "user:custom")
                .is_err()
        );
    }

    #[cfg(unix)]
    #[test]
    fn test_register_animation_rejects_symlink_outside_base_or_non_vrma() {
        use std::os::unix::fs::symlink;

        let tmp = TestDir::new("anim_symlink");
        let base_dir = tmp.path.join("safe");
        fs::create_dir_all(&base_dir).expect("mkdir");
        let outside_vrma = tmp.path.join("outside.vrma");
        write_file(&outside_vrma, b"OUTSIDE");
        let outside_txt = tmp.path.join("passwd.txt");
        write_file(&outside_txt, b"ROOT");

        let link_escape = base_dir.join("escape.vrma");
        symlink(&outside_vrma, &link_escape).expect("symlink");
        let link_non_vrma = base_dir.join("disguised.vrma");
        symlink(&outside_txt, &link_non_vrma).expect("symlink");

        let state = PluginState::default();
        assert!(register_user_animation_with_base(
            &state,
            "escape",
            link_escape.to_str().unwrap(),
            None,
            Some(&base_dir)
        )
        .is_err());
        assert!(register_user_animation_with_base(
            &state,
            "disguised",
            link_non_vrma.to_str().unwrap(),
            None,
            None
        )
        .is_err());
    }
}
