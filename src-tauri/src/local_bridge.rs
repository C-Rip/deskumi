//! Local WebSocket bridge (`127.0.0.1:0`) for external TTS/AI/VC integrations.
//!
//! Disabled by default (0 sockets, 0 Tokio tasks, 0 MB RAM overhead).
//! When enabled, enforces:
//! - Loopback-only binding (`127.0.0.1:0`) with no TLS.
//! - Anti-CSWSH handshake filtering (rejects any HTTP request containing `Origin`).
//! - Short timeouts (`<= 2 s`) for HTTP upgrade and initial `hello` auth frame.
//! - 256-bit CSPRNG token (`getrandom`) checked in constant time.
//! - Atomic `bridge.json` creation (`0600` on Unix) under `$XDG_RUNTIME_DIR/deskumi/bridge.json`.
//! - Operational limits from ADR-0006 (`maxClients = 4`, `5 MB` max WS message,
//!   `30 cmd/s` JSON control, `~512 KB/s` binary PCM) and `tauri::ipc::Channel`
//!   raw binary forwarding for `speakChunk`.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, watch, Mutex as AsyncMutex, OwnedSemaphorePermit, Semaphore};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tokio_tungstenite::tungstenite::{Error as WsError, Message};
use tokio_tungstenite::WebSocketStream;

use crate::error::AppError;

pub const BRIDGE_PROTOCOL_VERSION: u32 = 1;
pub const MAX_BRIDGE_CLIENTS: usize = 4;
pub const MAX_WS_MESSAGE_BYTES: usize = 5 * 1024 * 1024;
pub const CONTROL_RATE_LIMIT_PER_SEC: f64 = 30.0;
pub const BINARY_RATE_LIMIT_BYTES_PER_SEC: f64 = 512.0 * 1024.0;
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(2);
pub const HELLO_TIMEOUT: Duration = Duration::from_secs(2);
pub const MAX_STREAM_ID_LEN: usize = 128;
pub const MIN_SAMPLE_RATE: u32 = 8_000;
pub const MAX_SAMPLE_RATE: u32 = 48_000;
pub const BINARY_FRAME_MAGIC: &[u8; 4] = b"DSK1";
pub const BINARY_FRAME_KIND_SPEAK_CHUNK: u8 = 0x01;

const OUTBOUND_QUEUE_CAPACITY: usize = 128;
static TEMP_FILE_SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone)]
pub struct BridgeConfig {
    pub bridge_file_path: PathBuf,
    pub max_clients: usize,
    pub max_message_bytes: usize,
    pub handshake_timeout: Duration,
    pub hello_timeout: Duration,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            bridge_file_path: resolve_bridge_file_path(),
            max_clients: MAX_BRIDGE_CLIENTS,
            max_message_bytes: MAX_WS_MESSAGE_BYTES,
            handshake_timeout: HANDSHAKE_TIMEOUT,
            hello_timeout: HELLO_TIMEOUT,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub bridge_file_path: Option<String>,
    pub token: Option<String>,
    pub connected_clients: usize,
    pub max_clients: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeDiscoveryFile {
    pub version: u32,
    pub pid: u32,
    pub port: u16,
    pub token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboundBridgeMessage {
    pub target_client_ids: Option<Vec<String>>,
    pub payload: serde_json::Value,
}

#[derive(Clone)]
pub enum InboundSink {
    Tauri(Channel<InvokeResponseBody>),
    #[cfg(test)]
    Test(mpsc::UnboundedSender<TestInboundItem>),
}

#[cfg(test)]
#[derive(Debug, Clone)]
pub enum TestInboundItem {
    Json(serde_json::Value),
    Raw(Vec<u8>),
}

impl InboundSink {
    fn send_json(&self, value: &serde_json::Value) -> Result<(), String> {
        match self {
            Self::Tauri(channel) => {
                let json = serde_json::to_string(value)
                    .map_err(|e| format!("Failed to serialize inbound JSON: {e}"))?;
                channel
                    .send(InvokeResponseBody::Json(json))
                    .map_err(|e| format!("Failed to send inbound Channel JSON: {e}"))
            }
            #[cfg(test)]
            Self::Test(tx) => tx
                .send(TestInboundItem::Json(value.clone()))
                .map_err(|e| format!("Test inbound channel closed: {e}")),
        }
    }

    fn send_raw(&self, bytes: Vec<u8>) -> Result<(), String> {
        match self {
            Self::Tauri(channel) => channel
                .send(InvokeResponseBody::Raw(bytes))
                .map_err(|e| format!("Failed to send inbound Channel Raw: {e}")),
            #[cfg(test)]
            Self::Test(tx) => tx
                .send(TestInboundItem::Raw(bytes))
                .map_err(|e| format!("Test inbound channel closed: {e}")),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct ParsedWsBinaryChunk<'a> {
    pub stream_id: &'a str,
    pub sample_rate: u32,
    pub pcm: &'a [u8],
}

/// Parses an incoming WS binary frame for `speakChunk`:
/// `[0..4] "DSK1"`, `[4] kind=1`, `[5] flags=0`, `[6..8] streamIdLen (u16 BE)`,
/// `[8..12] sampleRate (u32 BE, 0 or 8000..=48000)`, `[12..12+len] streamId`,
/// `[12+len..] pcm bytes`.
pub fn parse_ws_binary_speak_chunk(data: &[u8]) -> Result<ParsedWsBinaryChunk<'_>, &'static str> {
    if data.len() < 14 {
        return Err("Binary frame is shorter than minimum header");
    }
    if data.len() > MAX_WS_MESSAGE_BYTES {
        return Err("Binary frame exceeds 5 MB limit");
    }
    if &data[0..4] != BINARY_FRAME_MAGIC {
        return Err("Invalid binary frame magic");
    }
    if data[4] != BINARY_FRAME_KIND_SPEAK_CHUNK {
        return Err("Unsupported binary frame kind");
    }
    if data[5] != 0x00 {
        return Err("Unsupported binary frame flags");
    }
    let stream_id_len = usize::from(u16::from_be_bytes([data[6], data[7]]));
    if stream_id_len == 0 || stream_id_len > MAX_STREAM_ID_LEN {
        return Err("Invalid streamId length in binary frame");
    }
    let payload_offset = 12usize
        .checked_add(stream_id_len)
        .ok_or("Binary header overflow")?;
    if payload_offset >= data.len() {
        return Err("Binary speakChunk missing PCM payload");
    }
    let sample_rate = u32::from_be_bytes([data[8], data[9], data[10], data[11]]);
    if sample_rate != 0 && !(MIN_SAMPLE_RATE..=MAX_SAMPLE_RATE).contains(&sample_rate) {
        return Err("Binary frame sampleRate must be 0 or 8000..=48000");
    }
    let stream_id = std::str::from_utf8(&data[12..payload_offset])
        .map_err(|_| "streamId in binary frame is not valid UTF-8")?;
    if stream_id.trim().is_empty() {
        return Err("streamId in binary frame must not be blank");
    }
    Ok(ParsedWsBinaryChunk {
        stream_id,
        sample_rate,
        pcm: &data[payload_offset..],
    })
}

/// Encodes a validated binary `speakChunk` for forwarding over `tauri::ipc::Channel`:
/// `[0..4] "DSK1"`, `[4] kind=1`, `[5] flags=0`, `[6..8] clientIdLen (u16 BE)`,
/// `[8..10] streamIdLen (u16 BE)`, `[10..14] sampleRate (u32 BE)`,
/// `clientId`, `streamId`, `pcm`.
pub fn encode_channel_binary_speak_chunk(
    client_id: &str,
    chunk: &ParsedWsBinaryChunk<'_>,
) -> Result<Vec<u8>, &'static str> {
    let client_bytes = client_id.as_bytes();
    let stream_bytes = chunk.stream_id.as_bytes();
    let client_len = u16::try_from(client_bytes.len()).map_err(|_| "clientId too long")?;
    let stream_len = u16::try_from(stream_bytes.len()).map_err(|_| "streamId too long")?;

    let total_len = 14usize + client_bytes.len() + stream_bytes.len() + chunk.pcm.len();
    let mut out = Vec::with_capacity(total_len);
    out.extend_from_slice(BINARY_FRAME_MAGIC);
    out.push(BINARY_FRAME_KIND_SPEAK_CHUNK);
    out.push(0x00);
    out.extend_from_slice(&client_len.to_be_bytes());
    out.extend_from_slice(&stream_len.to_be_bytes());
    out.extend_from_slice(&chunk.sample_rate.to_be_bytes());
    out.extend_from_slice(client_bytes);
    out.extend_from_slice(stream_bytes);
    out.extend_from_slice(chunk.pcm);
    Ok(out)
}

/// Generates a 256-bit CSPRNG token encoded as 64 lowercase hexadecimal chars.
pub fn generate_bridge_token() -> Result<String, AppError> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|e| AppError::Platform(format!("Failed to generate bridge token: {e}")))?;
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(char::from(HEX[usize::from(b >> 4)]));
        out.push(char::from(HEX[usize::from(b & 0x0f)]));
    }
    Ok(out)
}

/// Constant-time comparison over byte slices to prevent timing side-channels.
pub fn constant_time_eq(expected: &[u8], provided: &[u8]) -> bool {
    let mut diff: usize = expected.len() ^ provided.len();
    for (idx, &exp_byte) in expected.iter().enumerate() {
        let prov_byte = provided.get(idx).copied().unwrap_or(0);
        diff |= usize::from(exp_byte ^ prov_byte);
    }
    std::hint::black_box(diff) == 0
}

pub fn resolve_bridge_file_path() -> PathBuf {
    resolve_bridge_file_path_from_env(
        std::env::var_os("XDG_RUNTIME_DIR"),
        std::env::var_os("APPDATA"),
        std::env::var_os("XDG_DATA_HOME"),
        std::env::var_os("HOME"),
    )
}

pub fn resolve_bridge_file_path_from_env(
    xdg_runtime_dir: Option<std::ffi::OsString>,
    appdata: Option<std::ffi::OsString>,
    xdg_data_home: Option<std::ffi::OsString>,
    home: Option<std::ffi::OsString>,
) -> PathBuf {
    let non_empty = |v: Option<std::ffi::OsString>| v.filter(|s| !s.is_empty()).map(PathBuf::from);

    let base = if let Some(dir) = non_empty(xdg_runtime_dir) {
        dir
    } else if let Some(dir) = non_empty(appdata) {
        dir
    } else if let Some(dir) = non_empty(xdg_data_home) {
        dir
    } else if let Some(dir) = non_empty(home) {
        dir.join(".local").join("share")
    } else {
        std::env::temp_dir()
    };

    base.join("deskumi").join("bridge.json")
}

/// Atomically writes `bridge.json` with `0700` parent directory and `0600` file
/// permissions on Unix via `create_new` temp file + `rename`.
pub fn write_bridge_file_atomic(
    path: &Path,
    payload: &BridgeDiscoveryFile,
) -> Result<(), AppError> {
    let parent = path.parent().ok_or_else(|| {
        AppError::Platform("Invalid bridge.json path without parent directory".to_string())
    })?;

    ensure_private_dir(parent)?;

    let seq = TEMP_FILE_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp_name = format!(".bridge.json.tmp.{}.{seq}", std::process::id());
    let tmp_path = parent.join(tmp_name);
    let serialized = serde_json::to_vec_pretty(payload)
        .map_err(|e| AppError::Platform(format!("Failed to serialize bridge.json: {e}")))?;

    let write_res = (|| -> std::io::Result<()> {
        let mut opts = OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut file = opts.open(&tmp_path)?;
        file.write_all(&serialized)?;
        file.write_all(b"\n")?;
        file.flush()?;
        drop(file);
        fs::rename(&tmp_path, path)?;
        Ok(())
    })();

    if let Err(err) = write_res {
        let _ = fs::remove_file(&tmp_path);
        return Err(AppError::Platform(format!(
            "Failed to write {}: {err}",
            path.display()
        )));
    }

    Ok(())
}

fn ensure_private_dir(dir: &Path) -> Result<(), AppError> {
    if dir.exists() {
        let meta = fs::symlink_metadata(dir)
            .map_err(|e| AppError::Platform(format!("Failed to inspect {}: {e}", dir.display())))?;
        if meta.file_type().is_symlink() || !meta.is_dir() {
            return Err(AppError::Platform(format!(
                "Refusing to use unsafe bridge directory {}",
                dir.display()
            )));
        }
    } else {
        fs::create_dir_all(dir)
            .map_err(|e| AppError::Platform(format!("Failed to create {}: {e}", dir.display())))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).map_err(|e| {
            AppError::Platform(format!(
                "Failed to set 0700 permissions on {}: {e}",
                dir.display()
            ))
        })?;
    }

    Ok(())
}

pub fn remove_bridge_file(path: &Path) {
    if let Err(err) = fs::remove_file(path) {
        if err.kind() != std::io::ErrorKind::NotFound {
            log::warn!("Failed to remove {}: {err}", path.display());
        }
    }
}

struct TokenBucket {
    tokens: f64,
    capacity: f64,
    refill_per_sec: f64,
    last_refill: Instant,
}

impl TokenBucket {
    fn new(capacity: f64, refill_per_sec: f64) -> Self {
        Self {
            tokens: capacity,
            capacity,
            refill_per_sec,
            last_refill: Instant::now(),
        }
    }

    fn try_consume(&mut self, amount: f64) -> bool {
        let now = Instant::now();
        let elapsed = now
            .saturating_duration_since(self.last_refill)
            .as_secs_f64();
        self.last_refill = now;
        self.tokens = (self.tokens + elapsed * self.refill_per_sec).min(self.capacity);
        if self.tokens >= amount {
            self.tokens -= amount;
            true
        } else {
            false
        }
    }
}

struct BridgeInner {
    running: bool,
    port: Option<u16>,
    bridge_file_path: Option<PathBuf>,
    token: Option<String>,
    max_clients: usize,
    next_client_seq: u64,
    clients: HashMap<String, mpsc::Sender<Message>>,
    inbound_sink: Option<InboundSink>,
    listener_shutdown_tx: Option<watch::Sender<bool>>,
    clients_reset_tx: Option<watch::Sender<bool>>,
    listener_task: Option<JoinHandle<()>>,
}

impl Default for BridgeInner {
    fn default() -> Self {
        Self {
            running: false,
            port: None,
            bridge_file_path: None,
            token: None,
            max_clients: MAX_BRIDGE_CLIENTS,
            next_client_seq: 0,
            clients: HashMap::new(),
            inbound_sink: None,
            listener_shutdown_tx: None,
            clients_reset_tx: None,
            listener_task: None,
        }
    }
}

impl BridgeInner {
    fn to_status(&self) -> BridgeStatus {
        BridgeStatus {
            running: self.running,
            port: self.port,
            bridge_file_path: self
                .bridge_file_path
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned()),
            token: self.token.clone(),
            connected_clients: self.clients.len(),
            max_clients: self.max_clients,
        }
    }
}

#[derive(Clone)]
pub struct LocalBridgeState {
    lifecycle_lock: Arc<AsyncMutex<()>>,
    inner: Arc<Mutex<BridgeInner>>,
}

impl Default for LocalBridgeState {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalBridgeState {
    pub fn new() -> Self {
        Self {
            lifecycle_lock: Arc::new(AsyncMutex::new(())),
            inner: Arc::new(Mutex::new(BridgeInner::default())),
        }
    }

    pub async fn start(&self) -> Result<BridgeStatus, AppError> {
        self.start_with_config(BridgeConfig::default(), None).await
    }

    pub async fn start_with_config(
        &self,
        config: BridgeConfig,
        initial_sink: Option<InboundSink>,
    ) -> Result<BridgeStatus, AppError> {
        let _guard = self.lifecycle_lock.lock().await;

        if let Some(status) = self.running_status_snapshot()? {
            return Ok(status);
        }

        let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .map_err(|e| AppError::Platform(format!("Failed to bind 127.0.0.1:0: {e}")))?;
        let port = listener
            .local_addr()
            .map_err(|e| AppError::Platform(format!("Failed to read bridge socket addr: {e}")))?
            .port();
        let token = generate_bridge_token()?;

        let discovery = BridgeDiscoveryFile {
            version: BRIDGE_PROTOCOL_VERSION,
            pid: std::process::id(),
            port,
            token: token.clone(),
        };
        write_bridge_file_atomic(&config.bridge_file_path, &discovery)?;

        let (listener_shutdown_tx, listener_shutdown_rx) = watch::channel(false);
        let (clients_reset_tx, _) = watch::channel(false);

        {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| AppError::Platform("Bridge state mutex poisoned".to_string()))?;
            inner.running = true;
            inner.port = Some(port);
            inner.bridge_file_path = Some(config.bridge_file_path.clone());
            inner.token = Some(token);
            inner.max_clients = config.max_clients;
            inner.clients.clear();
            if initial_sink.is_some() {
                inner.inbound_sink = initial_sink;
            }
            inner.listener_shutdown_tx = Some(listener_shutdown_tx);
            inner.clients_reset_tx = Some(clients_reset_tx);
        }

        let inner_arc = Arc::clone(&self.inner);
        let accept_cfg = config.clone();
        let handle = tokio::spawn(async move {
            run_accept_loop(listener, accept_cfg, inner_arc, listener_shutdown_rx).await;
        });

        {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| AppError::Platform("Bridge state mutex poisoned".to_string()))?;
            inner.listener_task = Some(handle);
        }

        self.status()
    }

    pub async fn stop(&self) -> Result<BridgeStatus, AppError> {
        let _guard = self.lifecycle_lock.lock().await;

        let (task, shutdown_tx, file_path) = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| AppError::Platform("Bridge state mutex poisoned".to_string()))?;
            let task = inner.listener_task.take();
            let shutdown_tx = inner.listener_shutdown_tx.take();
            let file_path = inner.bridge_file_path.take();
            inner.running = false;
            inner.port = None;
            inner.token = None;
            inner.clients_reset_tx = None;
            inner.clients.clear();
            (task, shutdown_tx, file_path)
        };

        if let Some(path) = file_path {
            remove_bridge_file(&path);
        }
        if let Some(tx) = shutdown_tx {
            let _ = tx.send(true);
        }
        if let Some(mut handle) = task {
            if tokio::time::timeout(Duration::from_millis(500), &mut handle)
                .await
                .is_err()
            {
                handle.abort();
                let _ = handle.await;
            }
        }

        self.status()
    }

    pub async fn regenerate_token(&self) -> Result<BridgeStatus, AppError> {
        let _guard = self.lifecycle_lock.lock().await;
        let new_token = generate_bridge_token()?;

        let (port, path, old_reset_tx) = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| AppError::Platform("Bridge state mutex poisoned".to_string()))?;
            if !inner.running {
                return Err(AppError::Platform(
                    "Local bridge is not running".to_string(),
                ));
            }
            let port = inner
                .port
                .ok_or_else(|| AppError::Platform("Bridge port missing".to_string()))?;
            let path = inner
                .bridge_file_path
                .clone()
                .ok_or_else(|| AppError::Platform("Bridge file path missing".to_string()))?;

            let (new_reset_tx, _) = watch::channel(false);
            let old_reset_tx = inner.clients_reset_tx.replace(new_reset_tx);
            inner.token = Some(new_token.clone());
            (port, path, old_reset_tx)
        };

        let discovery = BridgeDiscoveryFile {
            version: BRIDGE_PROTOCOL_VERSION,
            pid: std::process::id(),
            port,
            token: new_token,
        };
        write_bridge_file_atomic(&path, &discovery)?;

        if let Some(tx) = old_reset_tx {
            let _ = tx.send(true);
        }

        self.status()
    }

    pub fn status(&self) -> Result<BridgeStatus, AppError> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| AppError::Platform("Bridge state mutex poisoned".to_string()))?;
        Ok(inner.to_status())
    }

    pub fn subscribe_inbound(&self, sink: InboundSink) -> Result<(), AppError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| AppError::Platform("Bridge state mutex poisoned".to_string()))?;
        inner.inbound_sink = Some(sink);
        Ok(())
    }

    pub fn send_event(&self, message: OutboundBridgeMessage) -> Result<(), AppError> {
        let text = serde_json::to_string(&message.payload)
            .map_err(|e| AppError::Platform(format!("Failed to serialize bridge event: {e}")))?;
        let ws_msg = Message::text(text);

        let targets: Vec<(String, mpsc::Sender<Message>)> = {
            let inner = self
                .inner
                .lock()
                .map_err(|_| AppError::Platform("Bridge state mutex poisoned".to_string()))?;
            match &message.target_client_ids {
                Some(ids) => ids
                    .iter()
                    .filter_map(|id| inner.clients.get(id).map(|tx| (id.clone(), tx.clone())))
                    .collect(),
                None => inner
                    .clients
                    .iter()
                    .map(|(id, tx)| (id.clone(), tx.clone()))
                    .collect(),
            }
        };

        for (client_id, tx) in targets {
            if let Err(err) = tx.try_send(ws_msg.clone()) {
                log::warn!("Dropping outbound WS message to {client_id}: {err}");
            }
        }

        Ok(())
    }

    /// Synchronous shutdown hook invoked on `RunEvent::Exit` to stop tasks and delete `bridge.json`.
    pub fn shutdown_sync(&self) {
        let (task, shutdown_tx, file_path) = {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            inner.running = false;
            inner.port = None;
            inner.token = None;
            inner.clients.clear();
            inner.clients_reset_tx = None;
            (
                inner.listener_task.take(),
                inner.listener_shutdown_tx.take(),
                inner.bridge_file_path.take(),
            )
        };

        if let Some(tx) = shutdown_tx {
            let _ = tx.send(true);
        }
        if let Some(handle) = task {
            handle.abort();
        }
        if let Some(path) = file_path {
            remove_bridge_file(&path);
        }
    }

    fn running_status_snapshot(&self) -> Result<Option<BridgeStatus>, AppError> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| AppError::Platform("Bridge state mutex poisoned".to_string()))?;
        if !inner.running {
            return Ok(None);
        }
        Ok(Some(inner.to_status()))
    }
}

async fn wait_for_true(rx: &mut watch::Receiver<bool>) {
    while !*rx.borrow() {
        if rx.changed().await.is_err() {
            break;
        }
    }
}

async fn run_accept_loop(
    listener: TcpListener,
    config: BridgeConfig,
    inner: Arc<Mutex<BridgeInner>>,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    let slots = Arc::new(Semaphore::new(config.max_clients));

    loop {
        let stream = tokio::select! {
            _ = wait_for_true(&mut shutdown_rx) => break,
            accept_res = listener.accept() => {
                match accept_res {
                    Ok((stream, _peer)) => stream,
                    Err(err) => {
                        log::warn!("Local bridge accept error: {err}");
                        break;
                    }
                }
            }
        };

        let Ok(permit) = Arc::clone(&slots).try_acquire_owned() else {
            let _ = stream.try_write(
                b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
            drop(stream);
            continue;
        };

        let task_inner = Arc::clone(&inner);
        let task_cfg = config.clone();
        let task_shutdown = shutdown_rx.clone();
        tokio::spawn(async move {
            handle_client_connection(stream, permit, task_cfg, task_inner, task_shutdown).await;
        });
    }
}

async fn handle_client_connection(
    stream: TcpStream,
    _permit: OwnedSemaphorePermit,
    config: BridgeConfig,
    inner: Arc<Mutex<BridgeInner>>,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    let ws_config = WebSocketConfig::default()
        .max_message_size(Some(config.max_message_bytes))
        .max_frame_size(Some(config.max_message_bytes));

    let handshake_fut = tokio_tungstenite::accept_hdr_async_with_config(
        stream,
        reject_origin_callback,
        Some(ws_config),
    );

    let mut ws_stream = tokio::select! {
        _ = wait_for_true(&mut shutdown_rx) => return,
        res = tokio::time::timeout(config.handshake_timeout, handshake_fut) => {
            match res {
                Ok(Ok(ws)) => ws,
                Ok(Err(_)) | Err(_) => return,
            }
        }
    };

    let Some((client_id, outbound_rx, mut reset_rx, _guard)) =
        authenticate_and_register(&mut ws_stream, &config, &inner, &mut shutdown_rx).await
    else {
        return;
    };

    run_client_loop(
        &mut ws_stream,
        &client_id,
        outbound_rx,
        &inner,
        &mut shutdown_rx,
        &mut reset_rx,
        config.max_message_bytes,
    )
    .await;
}

#[allow(clippy::result_large_err)]
fn reject_origin_callback(req: &Request, response: Response) -> Result<Response, ErrorResponse> {
    let has_origin = req
        .headers()
        .iter()
        .any(|(name, _)| name.as_str().eq_ignore_ascii_case("origin"));
    if has_origin {
        let body = "Origin header is not allowed".to_string();
        let mut err_resp = ErrorResponse::new(Some(body.clone()));
        *err_resp.status_mut() = StatusCode::FORBIDDEN;
        err_resp.headers_mut().insert(
            "Connection",
            "close"
                .parse()
                .unwrap_or_else(|_| unreachable!("static header")),
        );
        if let Ok(len_val) = body.len().to_string().parse() {
            err_resp.headers_mut().insert("Content-Length", len_val);
        }
        return Err(err_resp);
    }
    Ok(response)
}

struct ClientGuard {
    client_id: String,
    inner: Arc<Mutex<BridgeInner>>,
}

impl Drop for ClientGuard {
    fn drop(&mut self) {
        let sink = {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            inner.clients.remove(&self.client_id);
            inner.inbound_sink.clone()
        };

        if let Some(sink) = sink {
            let notice = serde_json::json!({
                "kind": "clientDisconnected",
                "clientId": self.client_id,
            });
            let _ = sink.send_json(&notice);
        }
    }
}

async fn authenticate_and_register(
    ws_stream: &mut WebSocketStream<TcpStream>,
    config: &BridgeConfig,
    inner: &Arc<Mutex<BridgeInner>>,
    shutdown_rx: &mut watch::Receiver<bool>,
) -> Option<(
    String,
    mpsc::Receiver<Message>,
    watch::Receiver<bool>,
    ClientGuard,
)> {
    let deadline = tokio::time::Instant::now() + config.hello_timeout;

    let first_text = loop {
        let item = tokio::select! {
            _ = wait_for_true(shutdown_rx) => return None,
            res = tokio::time::timeout_at(deadline, ws_stream.next()) => {
                match res {
                    Ok(Some(Ok(msg))) => msg,
                    Ok(Some(Err(WsError::Capacity(_)))) => {
                        send_error_and_close(ws_stream, "too_large", "WebSocket message exceeds 5 MB limit", None).await;
                        return None;
                    }
                    Ok(Some(Err(_))) | Ok(None) | Err(_) => {
                        let _ = ws_stream.close(None).await;
                        return None;
                    }
                }
            }
        };

        match item {
            Message::Text(text) => break text,
            Message::Ping(_) | Message::Pong(_) => continue,
            Message::Close(_) => return None,
            Message::Binary(_) | Message::Frame(_) => {
                send_error_and_close(
                    ws_stream,
                    "invalid",
                    "First message must be a v:1 hello JSON command",
                    None,
                )
                .await;
                return None;
            }
        }
    };

    let (expected_token, reset_rx) = {
        let guard = inner.lock().ok()?;
        (
            guard.token.clone()?,
            guard.clients_reset_tx.as_ref()?.subscribe(),
        )
    };

    let sanitized_hello = match parse_and_verify_hello(first_text.as_str(), &expected_token) {
        Ok(env) => env,
        Err((code, msg, ref_id)) => {
            send_error_and_close(ws_stream, code, &msg, ref_id.as_deref()).await;
            return None;
        }
    };

    let (outbound_tx, outbound_rx) = mpsc::channel(OUTBOUND_QUEUE_CAPACITY);
    let reg_result: Result<(String, InboundSink), bool> = {
        let mut guard = inner.lock().ok()?;
        let latest_token = guard.token.as_deref()?;
        if !constant_time_eq(latest_token.as_bytes(), expected_token.as_bytes()) {
            Err(false)
        } else if let Some(sink) = guard.inbound_sink.clone() {
            guard.next_client_seq += 1;
            let client_id = format!("ws:{}", guard.next_client_seq);
            guard.clients.insert(client_id.clone(), outbound_tx);
            Ok((client_id, sink))
        } else {
            Err(true)
        }
    };
    let (client_id, sink) = match reg_result {
        Ok(pair) => pair,
        Err(missing_sink) => {
            if missing_sink {
                send_error_and_close(ws_stream, "busy", "Avatar runtime is not attached", None)
                    .await;
            }
            return None;
        }
    };

    let guard = ClientGuard {
        client_id: client_id.clone(),
        inner: Arc::clone(inner),
    };

    let inbound = serde_json::json!({
        "kind": "command",
        "clientId": client_id,
        "envelope": sanitized_hello,
    });
    if sink.send_json(&inbound).is_err() {
        send_error_and_close(ws_stream, "busy", "Bridge consumer disconnected", None).await;
        return None;
    }

    Some((client_id, outbound_rx, reset_rx, guard))
}

fn parse_and_verify_hello(
    text: &str,
    expected_token: &str,
) -> Result<serde_json::Value, (&'static str, String, Option<String>)> {
    let mut val: serde_json::Value = serde_json::from_str(text)
        .map_err(|_| ("invalid", "Malformed JSON payload".to_string(), None))?;

    let ref_id = extract_ref_id(&val);

    let Some(obj) = val.as_object_mut() else {
        return Err((
            "invalid",
            "Command envelope must be an object".to_string(),
            None,
        ));
    };
    if obj.get("v").and_then(|v| v.as_u64()) != Some(u64::from(BRIDGE_PROTOCOL_VERSION)) {
        return Err((
            "invalid",
            "Unsupported protocol version; expected v: 1".to_string(),
            ref_id,
        ));
    }
    let Some(cmd_obj) = obj.get_mut("cmd").and_then(|c| c.as_object_mut()) else {
        return Err((
            "invalid",
            "First message must be a v:1 hello command".to_string(),
            ref_id,
        ));
    };
    if cmd_obj.get("type").and_then(|t| t.as_str()) != Some("hello") {
        return Err((
            "invalid",
            "First message must be a hello command".to_string(),
            ref_id,
        ));
    }

    let provided_token = cmd_obj
        .get("token")
        .and_then(|t| t.as_str())
        .ok_or_else(|| {
            (
                "forbidden",
                "Missing bridge authentication token".to_string(),
                ref_id.clone(),
            )
        })?;

    if !constant_time_eq(expected_token.as_bytes(), provided_token.as_bytes()) {
        return Err((
            "forbidden",
            "Invalid bridge authentication token".to_string(),
            ref_id,
        ));
    }

    cmd_obj.remove("token");
    Ok(val)
}

async fn run_client_loop(
    ws_stream: &mut WebSocketStream<TcpStream>,
    client_id: &str,
    mut outbound_rx: mpsc::Receiver<Message>,
    inner: &Arc<Mutex<BridgeInner>>,
    shutdown_rx: &mut watch::Receiver<bool>,
    reset_rx: &mut watch::Receiver<bool>,
    max_message_bytes: usize,
) {
    let mut control_bucket =
        TokenBucket::new(CONTROL_RATE_LIMIT_PER_SEC, CONTROL_RATE_LIMIT_PER_SEC);
    let mut binary_bucket = TokenBucket::new(
        BINARY_RATE_LIMIT_BYTES_PER_SEC,
        BINARY_RATE_LIMIT_BYTES_PER_SEC,
    );

    loop {
        tokio::select! {
            _ = wait_for_true(shutdown_rx) => {
                let _ = close_with_reason(ws_stream, "Bridge stopped").await;
                break;
            }
            _ = wait_for_true(reset_rx) => {
                let _ = close_with_reason(ws_stream, "Token rotated").await;
                break;
            }
            maybe_out = outbound_rx.recv() => {
                let Some(msg) = maybe_out else { break };
                if ws_stream.send(msg).await.is_err() {
                    break;
                }
            }
            ws_item = ws_stream.next() => {
                let msg = match ws_item {
                    Some(Ok(msg)) => msg,
                    Some(Err(WsError::Capacity(_))) => {
                        send_error_and_close(
                            ws_stream,
                            "too_large",
                            "WebSocket message exceeds 5 MB limit",
                            None,
                        ).await;
                        break;
                    }
                    Some(Err(_)) | None => break,
                };

                match msg {
                    Message::Close(_) => break,
                    Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => continue,
                    Message::Text(text) => {
                        if text.len() > max_message_bytes {
                            send_error_and_close(
                                ws_stream,
                                "too_large",
                                "WebSocket message exceeds 5 MB limit",
                                None,
                            ).await;
                            break;
                        }
                        if !handle_text_message(
                            ws_stream,
                            client_id,
                            text.as_str(),
                            inner,
                            &mut control_bucket,
                        ).await {
                            break;
                        }
                    }
                    Message::Binary(bytes) => {
                        if bytes.len() > max_message_bytes {
                            send_error_and_close(
                                ws_stream,
                                "too_large",
                                "WebSocket message exceeds 5 MB limit",
                                None,
                            ).await;
                            break;
                        }
                        if !handle_binary_message(
                            ws_stream,
                            client_id,
                            &bytes,
                            inner,
                            &mut binary_bucket,
                        ).await {
                            break;
                        }
                    }
                }
            }
        }
    }
}

async fn handle_text_message(
    ws_stream: &mut WebSocketStream<TcpStream>,
    client_id: &str,
    text: &str,
    inner: &Arc<Mutex<BridgeInner>>,
    control_bucket: &mut TokenBucket,
) -> bool {
    if !control_bucket.try_consume(1.0) {
        let ref_id = serde_json::from_str::<serde_json::Value>(text)
            .ok()
            .and_then(|v| extract_ref_id(&v));
        return send_ws_error(
            ws_stream,
            "rate_limited",
            "Control command rate limit exceeded (30 cmd/s)",
            ref_id.as_deref(),
        )
        .await
        .is_ok();
    }

    let mut val: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => {
            return send_ws_error(ws_stream, "invalid", "Malformed JSON payload", None)
                .await
                .is_ok();
        }
    };

    if let Some(cmd_obj) = val.get_mut("cmd").and_then(|c| c.as_object_mut()) {
        if cmd_obj.get("type").and_then(|t| t.as_str()) == Some("hello") {
            if let Some(provided) = cmd_obj.get("token").and_then(|t| t.as_str()) {
                let expected = inner
                    .lock()
                    .ok()
                    .and_then(|g| g.token.clone())
                    .unwrap_or_default();
                if !constant_time_eq(expected.as_bytes(), provided.as_bytes()) {
                    let ref_id = extract_ref_id(&val);
                    let _ = send_error_and_close(
                        ws_stream,
                        "forbidden",
                        "Invalid bridge authentication token",
                        ref_id.as_deref(),
                    )
                    .await;
                    return false;
                }
                cmd_obj.remove("token");
            }
        }
    }

    let sink = inner.lock().ok().and_then(|g| g.inbound_sink.clone());
    if let Some(sink) = sink {
        let inbound = serde_json::json!({
            "kind": "command",
            "clientId": client_id,
            "envelope": val,
        });
        if sink.send_json(&inbound).is_err() {
            let _ = send_ws_error(ws_stream, "busy", "Bridge consumer disconnected", None).await;
        }
    } else {
        let ref_id = extract_ref_id(&val);
        let _ = send_ws_error(
            ws_stream,
            "busy",
            "Avatar runtime is not attached",
            ref_id.as_deref(),
        )
        .await;
    }

    true
}

async fn handle_binary_message(
    ws_stream: &mut WebSocketStream<TcpStream>,
    client_id: &str,
    bytes: &[u8],
    inner: &Arc<Mutex<BridgeInner>>,
    binary_bucket: &mut TokenBucket,
) -> bool {
    let chunk = match parse_ws_binary_speak_chunk(bytes) {
        Ok(c) => c,
        Err(reason) => {
            return send_ws_error(ws_stream, "invalid", reason, None)
                .await
                .is_ok();
        }
    };

    if !binary_bucket.try_consume(chunk.pcm.len() as f64) {
        return send_ws_error(
            ws_stream,
            "rate_limited",
            "Binary PCM rate limit exceeded (~512 KB/s)",
            None,
        )
        .await
        .is_ok();
    }

    let encoded = match encode_channel_binary_speak_chunk(client_id, &chunk) {
        Ok(buf) => buf,
        Err(reason) => {
            return send_ws_error(ws_stream, "invalid", reason, None)
                .await
                .is_ok();
        }
    };

    let sink = inner.lock().ok().and_then(|g| g.inbound_sink.clone());
    if let Some(sink) = sink {
        if sink.send_raw(encoded).is_err() {
            let _ = send_ws_error(ws_stream, "busy", "Bridge consumer disconnected", None).await;
        }
    } else {
        let _ = send_ws_error(ws_stream, "busy", "Avatar runtime is not attached", None).await;
    }

    true
}

fn extract_ref_id(val: &serde_json::Value) -> Option<String> {
    let id = val.get("id")?.as_str()?;
    if id.trim().is_empty() || id.len() > MAX_STREAM_ID_LEN {
        return None;
    }
    Some(id.to_string())
}

fn build_error_json(code: &str, message: &str, ref_id: Option<&str>) -> String {
    let payload = match ref_id {
        Some(r) => serde_json::json!({
            "v": BRIDGE_PROTOCOL_VERSION,
            "type": "error",
            "ref": r,
            "code": code,
            "message": message,
        }),
        None => serde_json::json!({
            "v": BRIDGE_PROTOCOL_VERSION,
            "type": "error",
            "code": code,
            "message": message,
        }),
    };
    payload.to_string()
}

async fn send_ws_error(
    ws_stream: &mut WebSocketStream<TcpStream>,
    code: &str,
    message: &str,
    ref_id: Option<&str>,
) -> Result<(), WsError> {
    ws_stream
        .send(Message::text(build_error_json(code, message, ref_id)))
        .await
}

async fn send_error_and_close(
    ws_stream: &mut WebSocketStream<TcpStream>,
    code: &str,
    message: &str,
    ref_id: Option<&str>,
) {
    let _ = send_ws_error(ws_stream, code, message, ref_id).await;
    let _ = close_with_reason(ws_stream, message).await;
}

async fn close_with_reason(
    ws_stream: &mut WebSocketStream<TcpStream>,
    reason: &str,
) -> Result<(), WsError> {
    let frame = CloseFrame {
        code: CloseCode::Normal,
        reason: reason.chars().take(120).collect::<String>().into(),
    };
    ws_stream.close(Some(frame)).await
}

#[tauri::command]
pub async fn start_local_bridge(
    state: tauri::State<'_, LocalBridgeState>,
) -> Result<BridgeStatus, AppError> {
    state.start().await
}

#[tauri::command]
pub async fn stop_local_bridge(
    state: tauri::State<'_, LocalBridgeState>,
) -> Result<BridgeStatus, AppError> {
    state.stop().await
}

#[tauri::command]
pub fn get_bridge_status(
    state: tauri::State<'_, LocalBridgeState>,
) -> Result<BridgeStatus, AppError> {
    state.status()
}

#[tauri::command]
pub async fn regenerate_bridge_token(
    state: tauri::State<'_, LocalBridgeState>,
) -> Result<BridgeStatus, AppError> {
    state.regenerate_token().await
}

#[tauri::command]
pub fn subscribe_bridge_inbound(
    state: tauri::State<'_, LocalBridgeState>,
    channel: Channel<InvokeResponseBody>,
) -> Result<(), AppError> {
    state.subscribe_inbound(InboundSink::Tauri(channel))
}

#[tauri::command]
pub fn send_bridge_event(
    state: tauri::State<'_, LocalBridgeState>,
    message: OutboundBridgeMessage,
) -> Result<(), AppError> {
    state.send_event(message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    fn test_temp_dir(name: &str) -> PathBuf {
        let seq = TEMP_FILE_SEQ.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "deskumi-bridge-test-{name}-{}-{seq}",
            std::process::id()
        ))
    }

    fn build_ws_binary_frame(stream_id: &str, sample_rate: u32, pcm: &[u8]) -> Vec<u8> {
        let stream_bytes = stream_id.as_bytes();
        let mut out = Vec::with_capacity(12 + stream_bytes.len() + pcm.len());
        out.extend_from_slice(BINARY_FRAME_MAGIC);
        out.push(BINARY_FRAME_KIND_SPEAK_CHUNK);
        out.push(0x00);
        out.extend_from_slice(&(stream_bytes.len() as u16).to_be_bytes());
        out.extend_from_slice(&sample_rate.to_be_bytes());
        out.extend_from_slice(stream_bytes);
        out.extend_from_slice(pcm);
        out
    }

    async fn connect_ws(
        port: u16,
        origin: Option<&str>,
    ) -> Result<WebSocketStream<TcpStream>, WsError> {
        let tcp = TcpStream::connect(SocketAddr::from(([127, 0, 0, 1], port)))
            .await
            .expect("tcp connect");
        let mut req = format!("ws://127.0.0.1:{port}/")
            .into_client_request()
            .expect("client request");
        if let Some(orig) = origin {
            req.headers_mut()
                .insert("Origin", orig.parse().expect("origin header"));
        }
        let (ws, _resp) = tokio_tungstenite::client_async(req, tcp).await?;
        Ok(ws)
    }

    fn test_config(dir: &Path) -> BridgeConfig {
        BridgeConfig {
            bridge_file_path: dir.join("deskumi").join("bridge.json"),
            max_clients: MAX_BRIDGE_CLIENTS,
            max_message_bytes: MAX_WS_MESSAGE_BYTES,
            handshake_timeout: HANDSHAKE_TIMEOUT,
            hello_timeout: HELLO_TIMEOUT,
        }
    }

    #[test]
    fn token_is_256_bits_hex_and_constant_time_eq_works() {
        let t1 = generate_bridge_token().expect("token1");
        let t2 = generate_bridge_token().expect("token2");
        assert_eq!(t1.len(), 64);
        assert_eq!(t2.len(), 64);
        assert_ne!(t1, t2);
        assert!(t1.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')));
        assert!(constant_time_eq(t1.as_bytes(), t1.as_bytes()));
        assert!(!constant_time_eq(t1.as_bytes(), t2.as_bytes()));
        assert!(!constant_time_eq(t1.as_bytes(), &t1.as_bytes()[..63]));
        assert!(!constant_time_eq(b"abc", b"abcd"));
    }

    #[test]
    fn resolve_bridge_path_prefers_xdg_runtime_dir_and_falls_back() {
        assert_eq!(
            resolve_bridge_file_path_from_env(
                Some(OsString::from("/run/user/1000")),
                Some(OsString::from("C:\\AppData")),
                None,
                None,
            ),
            PathBuf::from("/run/user/1000/deskumi/bridge.json")
        );
        assert_eq!(
            resolve_bridge_file_path_from_env(
                Some(OsString::from("")),
                Some(OsString::from("/tmp/appdata")),
                None,
                None,
            ),
            PathBuf::from("/tmp/appdata/deskumi/bridge.json")
        );
        assert_eq!(
            resolve_bridge_file_path_from_env(None, None, None, Some(OsString::from("/home/u"))),
            PathBuf::from("/home/u/.local/share/deskumi/bridge.json")
        );
    }

    #[test]
    fn binary_speak_chunk_codec_validates_and_encodes_for_channel() {
        let pcm = vec![1u8, 2, 3, 4, 5, 6];
        let raw_ws = build_ws_binary_frame("stream-1", 22050, &pcm);
        let parsed = parse_ws_binary_speak_chunk(&raw_ws).expect("valid binary chunk");
        assert_eq!(parsed.stream_id, "stream-1");
        assert_eq!(parsed.sample_rate, 22050);
        assert_eq!(parsed.pcm, &pcm[..]);

        let encoded = encode_channel_binary_speak_chunk("ws:7", &parsed).expect("channel frame");
        assert_eq!(&encoded[0..4], b"DSK1");
        assert_eq!(encoded[4], 1);
        assert_eq!(encoded[5], 0);
        assert_eq!(u16::from_be_bytes([encoded[6], encoded[7]]), 4);
        assert_eq!(u16::from_be_bytes([encoded[8], encoded[9]]), 8);
        assert_eq!(
            u32::from_be_bytes([encoded[10], encoded[11], encoded[12], encoded[13]]),
            22050
        );
        assert_eq!(&encoded[14..18], b"ws:7");
        assert_eq!(&encoded[18..26], b"stream-1");
        assert_eq!(&encoded[26..], &pcm[..]);

        assert!(parse_ws_binary_speak_chunk(b"SHORT").is_err());
        assert!(parse_ws_binary_speak_chunk(&build_ws_binary_frame("s", 4000, &pcm)).is_err());
        assert!(parse_ws_binary_speak_chunk(&build_ws_binary_frame("s", 22050, &[])).is_err());
        assert!(parse_ws_binary_speak_chunk(&build_ws_binary_frame("   ", 22050, &pcm)).is_err());
    }

    #[tokio::test]
    async fn disabled_by_default_and_writes_0600_bridge_json_removed_on_stop_and_exit() {
        let dir = test_temp_dir("lifecycle");
        let cfg = test_config(&dir);
        let bridge = LocalBridgeState::new();

        let initial = bridge.status().expect("status");
        assert!(!initial.running);
        assert_eq!(initial.port, None);
        assert_eq!(initial.token, None);
        assert!(!cfg.bridge_file_path.exists());

        let (tx, _rx) = mpsc::unbounded_channel();
        let started = bridge
            .start_with_config(cfg.clone(), Some(InboundSink::Test(tx)))
            .await
            .expect("start");
        assert!(started.running);
        let port = started.port.expect("port");
        let token = started.token.clone().expect("token");
        assert!(cfg.bridge_file_path.exists());

        // Idempotent start returns same port/token
        let second = bridge
            .start_with_config(cfg.clone(), None)
            .await
            .expect("idempotent");
        assert_eq!(second.port, Some(port));
        assert_eq!(second.token.as_deref(), Some(token.as_str()));

        let content = fs::read_to_string(&cfg.bridge_file_path).expect("read bridge.json");
        let parsed: BridgeDiscoveryFile =
            serde_json::from_str(&content).expect("parse bridge.json");
        assert_eq!(parsed.version, 1);
        assert_eq!(parsed.pid, std::process::id());
        assert_eq!(parsed.port, port);
        assert_eq!(parsed.token, token);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let file_mode = fs::metadata(&cfg.bridge_file_path)
                .expect("file meta")
                .permissions()
                .mode()
                & 0o777;
            let dir_mode = fs::metadata(cfg.bridge_file_path.parent().expect("parent"))
                .expect("dir meta")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(file_mode, 0o600);
            assert_eq!(dir_mode, 0o700);
        }

        let stopped = bridge.stop().await.expect("stop");
        assert!(!stopped.running);
        assert!(!cfg.bridge_file_path.exists());

        // Restart and verify RunEvent::Exit synchronous cleanup removes bridge.json
        let (tx2, _rx2) = mpsc::unbounded_channel();
        bridge
            .start_with_config(cfg.clone(), Some(InboundSink::Test(tx2)))
            .await
            .expect("restart");
        assert!(cfg.bridge_file_path.exists());
        bridge.shutdown_sync();
        assert!(!cfg.bridge_file_path.exists());
        assert!(!bridge.status().expect("status").running);

        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn rejects_handshake_with_origin_header_anti_cswsh() {
        let dir = test_temp_dir("origin");
        let bridge = LocalBridgeState::new();
        let (tx, _rx) = mpsc::unbounded_channel();
        let status = bridge
            .start_with_config(test_config(&dir), Some(InboundSink::Test(tx)))
            .await
            .expect("start");
        let port = status.port.expect("port");

        let err = connect_ws(port, Some("https://evil.example"))
            .await
            .expect_err("Origin header must be rejected");
        match err {
            WsError::Http(resp) => assert_eq!(resp.status(), StatusCode::FORBIDDEN),
            other => panic!("Expected HTTP 403 error, got {other:?}"),
        }

        bridge.stop().await.expect("stop");
        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn rejects_wrong_token_and_closes_connection() {
        let dir = test_temp_dir("bad-token");
        let bridge = LocalBridgeState::new();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let status = bridge
            .start_with_config(test_config(&dir), Some(InboundSink::Test(tx)))
            .await
            .expect("start");
        let port = status.port.expect("port");

        let mut ws = connect_ws(port, None).await.expect("ws connect");
        ws.send(Message::text(
            serde_json::json!({
                "v": 1,
                "id": "auth-1",
                "cmd": { "type": "hello", "token": "wrong-token" }
            })
            .to_string(),
        ))
        .await
        .expect("send bad hello");

        let reply = ws.next().await.expect("error frame").expect("ws ok");
        let json: serde_json::Value =
            serde_json::from_str(reply.to_text().expect("text")).expect("json");
        assert_eq!(json["type"], "error");
        assert_eq!(json["code"], "forbidden");
        assert_eq!(json["ref"], "auth-1");

        // Next read observes close
        let next = ws.next().await;
        assert!(matches!(next, None | Some(Ok(Message::Close(_)))));
        assert!(rx.try_recv().is_err());

        bridge.stop().await.expect("stop");
        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn closes_connection_on_hello_timeout() {
        let dir = test_temp_dir("hello-timeout");
        let mut cfg = test_config(&dir);
        cfg.hello_timeout = Duration::from_millis(120);
        let bridge = LocalBridgeState::new();
        let (tx, _rx) = mpsc::unbounded_channel();
        let status = bridge
            .start_with_config(cfg, Some(InboundSink::Test(tx)))
            .await
            .expect("start");
        let port = status.port.expect("port");

        let mut ws = connect_ws(port, None).await.expect("ws connect");
        let res = tokio::time::timeout(Duration::from_secs(1), ws.next())
            .await
            .expect("should close promptly after hello timeout");
        assert!(matches!(
            res,
            None | Some(Ok(Message::Close(_))) | Some(Err(_))
        ));

        bridge.stop().await.expect("stop");
        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn enforces_max_clients_limit_of_four() {
        let dir = test_temp_dir("max-clients");
        let bridge = LocalBridgeState::new();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let status = bridge
            .start_with_config(test_config(&dir), Some(InboundSink::Test(tx)))
            .await
            .expect("start");
        let port = status.port.expect("port");
        let token = status.token.expect("token");

        let mut clients = Vec::new();
        for i in 0..MAX_BRIDGE_CLIENTS {
            let mut ws = connect_ws(port, None).await.expect("connect");
            ws.send(Message::text(
                serde_json::json!({
                    "v": 1,
                    "id": format!("h-{i}"),
                    "cmd": { "type": "hello", "token": token }
                })
                .to_string(),
            ))
            .await
            .expect("hello");
            let _ = rx.recv().await.expect("inbound hello");
            clients.push(ws);
        }

        assert_eq!(bridge.status().expect("status").connected_clients, 4);

        // 5th connection must be rejected
        let fifth = connect_ws(port, None).await;
        assert!(fifth.is_err());

        // Dropping 1st client frees a slot
        drop(clients.remove(0));
        let _ = rx.recv().await.expect("disconnect notice");
        tokio::time::sleep(Duration::from_millis(30)).await;

        let mut replacement = connect_ws(port, None).await.expect("replacement connects");
        replacement
            .send(Message::text(
                serde_json::json!({
                    "v": 1,
                    "cmd": { "type": "hello", "token": token }
                })
                .to_string(),
            ))
            .await
            .expect("hello");
        let _ = rx.recv().await.expect("inbound replacement hello");

        bridge.stop().await.expect("stop");
        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn rejects_oversized_frame_above_5mb() {
        let dir = test_temp_dir("oversized");
        let bridge = LocalBridgeState::new();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let status = bridge
            .start_with_config(test_config(&dir), Some(InboundSink::Test(tx)))
            .await
            .expect("start");
        let port = status.port.expect("port");
        let token = status.token.expect("token");

        let mut ws = connect_ws(port, None).await.expect("connect");
        ws.send(Message::text(
            serde_json::json!({
                "v": 1,
                "cmd": { "type": "hello", "token": token }
            })
            .to_string(),
        ))
        .await
        .expect("hello");
        let _ = rx.recv().await.expect("inbound hello");

        let too_big = vec![0x41u8; MAX_WS_MESSAGE_BYTES + 1024];
        let _ = ws.send(Message::binary(too_big)).await;

        let reply = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await
            .expect("timely rejection");
        match reply {
            Some(Ok(Message::Text(txt))) => {
                let json: serde_json::Value = serde_json::from_str(txt.as_str()).expect("json");
                assert_eq!(json["code"], "too_large");
            }
            None | Some(Ok(Message::Close(_))) | Some(Err(_)) => {}
            other => panic!("Unexpected response to >5MB frame: {other:?}"),
        }

        bridge.stop().await.expect("stop");
        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn handles_malformed_json_and_streams_binary_pcm_and_notifies_disconnect() {
        let dir = test_temp_dir("stream-roundtrip");
        let bridge = LocalBridgeState::new();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let status = bridge
            .start_with_config(test_config(&dir), Some(InboundSink::Test(tx)))
            .await
            .expect("start");
        let port = status.port.expect("port");
        let token = status.token.expect("token");

        let mut ws = connect_ws(port, None).await.expect("connect");
        ws.send(Message::text(
            serde_json::json!({
                "v": 1,
                "id": "h1",
                "cmd": { "type": "hello", "token": token, "events": ["speechEnd"] }
            })
            .to_string(),
        ))
        .await
        .expect("hello");

        let client_id = match rx.recv().await.expect("hello inbound") {
            TestInboundItem::Json(v) => {
                assert_eq!(v["kind"], "command");
                assert!(v["envelope"]["cmd"].get("token").is_none());
                v["clientId"].as_str().expect("clientId").to_string()
            }
            other => panic!("Expected JSON hello, got {other:?}"),
        };

        // Outbound reply routing back to client
        bridge
            .send_event(OutboundBridgeMessage {
                target_client_ids: Some(vec![client_id.clone()]),
                payload: serde_json::json!({ "v": 1, "type": "ack", "ref": "h1" }),
            })
            .expect("send ack");
        let ack_msg = ws.next().await.expect("ack").expect("ok");
        let ack_json: serde_json::Value =
            serde_json::from_str(ack_msg.to_text().expect("text")).expect("json");
        assert_eq!(ack_json["type"], "ack");
        assert_eq!(ack_json["ref"], "h1");

        // Malformed JSON gets error: invalid without dropping connection
        ws.send(Message::text("{broken json"))
            .await
            .expect("send bad");
        let err_msg = ws.next().await.expect("err").expect("ok");
        let err_json: serde_json::Value =
            serde_json::from_str(err_msg.to_text().expect("text")).expect("json");
        assert_eq!(err_json["type"], "error");
        assert_eq!(err_json["code"], "invalid");

        // Valid binary speakChunk travels as Raw Channel frame with clientId + streamId + PCM
        let pcm = vec![10u8, 20, 30, 40, 50, 60];
        ws.send(Message::binary(build_ws_binary_frame("tts-1", 24000, &pcm)))
            .await
            .expect("send binary chunk");
        match rx.recv().await.expect("raw inbound") {
            TestInboundItem::Raw(raw) => {
                assert_eq!(&raw[0..4], b"DSK1");
                let cid_len = usize::from(u16::from_be_bytes([raw[6], raw[7]]));
                let sid_len = usize::from(u16::from_be_bytes([raw[8], raw[9]]));
                let sr = u32::from_be_bytes([raw[10], raw[11], raw[12], raw[13]]);
                assert_eq!(sr, 24000);
                assert_eq!(&raw[14..14 + cid_len], client_id.as_bytes());
                assert_eq!(&raw[14 + cid_len..14 + cid_len + sid_len], b"tts-1");
                assert_eq!(&raw[14 + cid_len + sid_len..], &pcm[..]);
            }
            other => panic!("Expected Raw binary frame, got {other:?}"),
        }

        // Dropping client mid-stream emits clientDisconnected cleanup notice
        drop(ws);
        let disc = tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .expect("timely disconnect notice")
            .expect("notice");
        match disc {
            TestInboundItem::Json(v) => {
                assert_eq!(v["kind"], "clientDisconnected");
                assert_eq!(v["clientId"], client_id);
            }
            other => panic!("Expected clientDisconnected JSON, got {other:?}"),
        }

        bridge.stop().await.expect("stop");
        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn enforces_control_rate_limit_and_token_rotation() {
        let dir = test_temp_dir("rate-and-rotate");
        let bridge = LocalBridgeState::new();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let status = bridge
            .start_with_config(test_config(&dir), Some(InboundSink::Test(tx)))
            .await
            .expect("start");
        let port = status.port.expect("port");
        let old_token = status.token.expect("token");

        let mut ws = connect_ws(port, None).await.expect("connect");
        ws.send(Message::text(
            serde_json::json!({
                "v": 1,
                "cmd": { "type": "hello", "token": old_token }
            })
            .to_string(),
        ))
        .await
        .expect("hello");
        let _ = rx.recv().await.expect("inbound hello");

        // Burst 35 JSON commands -> at least one rate_limited response
        let mut saw_rate_limited = false;
        for i in 0..35 {
            ws.send(Message::text(
                serde_json::json!({
                    "v": 1,
                    "id": format!("say-{i}"),
                    "cmd": { "type": "say", "text": "ping" }
                })
                .to_string(),
            ))
            .await
            .expect("send say");
        }
        while let Ok(Some(Ok(Message::Text(txt)))) =
            tokio::time::timeout(Duration::from_millis(100), ws.next()).await
        {
            let v: serde_json::Value = serde_json::from_str(txt.as_str()).expect("json");
            if v["code"] == "rate_limited" {
                saw_rate_limited = true;
                break;
            }
        }
        assert!(saw_rate_limited);

        // Rotate token -> disconnects old client and updates bridge.json
        let rotated = bridge.regenerate_token().await.expect("rotate");
        let new_token = rotated.token.expect("new token");
        assert_ne!(new_token, old_token);

        let closed = tokio::time::timeout(Duration::from_secs(2), async {
            while let Some(item) = ws.next().await {
                if matches!(item, Ok(Message::Close(_)) | Err(_)) {
                    return true;
                }
            }
            true
        })
        .await
        .expect("old client closed on rotation");
        assert!(closed);

        // Old token rejected, new token accepted
        let mut ws_old = connect_ws(port, None).await.expect("connect");
        ws_old
            .send(Message::text(
                serde_json::json!({
                    "v": 1,
                    "cmd": { "type": "hello", "token": old_token }
                })
                .to_string(),
            ))
            .await
            .expect("send old");
        let err_reply = ws_old.next().await.expect("reply").expect("ok");
        let err_json: serde_json::Value =
            serde_json::from_str(err_reply.to_text().expect("text")).expect("json");
        assert_eq!(err_json["code"], "forbidden");

        let mut ws_new = connect_ws(port, None).await.expect("connect");
        ws_new
            .send(Message::text(
                serde_json::json!({
                    "v": 1,
                    "cmd": { "type": "hello", "token": new_token }
                })
                .to_string(),
            ))
            .await
            .expect("send new");
        match rx.recv().await {
            Some(TestInboundItem::Json(v)) if v["kind"] == "clientDisconnected" => {
                // Drain prior disconnect first if still queued, then read command
                let next = rx.recv().await.expect("hello");
                assert!(matches!(next, TestInboundItem::Json(j) if j["kind"] == "command"));
            }
            Some(TestInboundItem::Json(v)) => assert_eq!(v["kind"], "command"),
            other => panic!("Expected command/disconnect, got {other:?}"),
        }

        bridge.stop().await.expect("stop");
        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn enforces_binary_pcm_rate_limit() {
        let dir = test_temp_dir("binary-rate");
        let bridge = LocalBridgeState::new();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let status = bridge
            .start_with_config(test_config(&dir), Some(InboundSink::Test(tx)))
            .await
            .expect("start");
        let port = status.port.expect("port");
        let token = status.token.expect("token");

        let mut ws = connect_ws(port, None).await.expect("connect");
        ws.send(Message::text(
            serde_json::json!({
                "v": 1,
                "cmd": { "type": "hello", "token": token }
            })
            .to_string(),
        ))
        .await
        .expect("hello");
        let _ = rx.recv().await.expect("inbound hello");

        // Send > 512 KB in 3 x 200 KB binary chunks back-to-back
        let chunk = vec![0x55u8; 200 * 1024];
        let frame = build_ws_binary_frame("stream-rate", 22050, &chunk);
        for _ in 0..3 {
            ws.send(Message::binary(frame.clone()))
                .await
                .expect("send binary");
        }

        let reply = tokio::time::timeout(Duration::from_secs(1), ws.next())
            .await
            .expect("rate limit reply")
            .expect("frame")
            .expect("ok");
        let err_json: serde_json::Value =
            serde_json::from_str(reply.to_text().expect("text")).expect("json");
        assert_eq!(err_json["type"], "error");
        assert_eq!(err_json["code"], "rate_limited");

        bridge.stop().await.expect("stop");
        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn closes_raw_tcp_connection_on_handshake_timeout() {
        use tokio::io::AsyncReadExt;

        let dir = test_temp_dir("handshake-timeout");
        let mut cfg = test_config(&dir);
        cfg.handshake_timeout = Duration::from_millis(120);
        let bridge = LocalBridgeState::new();
        let (tx, _rx) = mpsc::unbounded_channel();
        let status = bridge
            .start_with_config(cfg, Some(InboundSink::Test(tx)))
            .await
            .expect("start");
        let port = status.port.expect("port");

        let mut tcp = TcpStream::connect(SocketAddr::from(([127, 0, 0, 1], port)))
            .await
            .expect("tcp connect");
        let mut buf = [0u8; 64];
        let read_res = tokio::time::timeout(Duration::from_secs(1), tcp.read(&mut buf))
            .await
            .expect("handshake should timeout promptly");
        assert!(matches!(read_res, Ok(0) | Err(_)));

        bridge.stop().await.expect("stop");
        let _ = fs::remove_dir_all(&dir);
    }
}
