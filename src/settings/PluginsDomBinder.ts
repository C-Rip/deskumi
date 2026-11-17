export interface PluginsDomHandlers {
  onRefresh: () => void;
  onTogglePlugin: (pluginId: string) => void;
  onPermissionChange: (
    pluginId: string,
    permission: string,
    checked: boolean
  ) => void;
  onAnimIdInput: (value: string) => boolean;
  onAnimLabelInput: (value: string) => void;
  onPickVrma: () => void;
  onRegisterAnim: () => void;
  onUnregisterAnim: (animId: string) => void;
}

export function bindPluginsSectionEvents(
  container: HTMLElement,
  handlers: PluginsDomHandlers
): void {
  const q = <T extends Element>(sel: string) => container.querySelector<T>(sel);
  const qa = <T extends Element>(sel: string) =>
    Array.from(container.querySelectorAll<T>(sel));

  q<HTMLButtonElement>("#btn-plugins-refresh")?.addEventListener(
    "click",
    handlers.onRefresh
  );

  for (const btn of qa<HTMLButtonElement>(".plugin-toggle-btn")) {
    btn.addEventListener("click", () => {
      const pluginId = btn.getAttribute("data-plugin-id");
      if (pluginId) handlers.onTogglePlugin(pluginId);
    });
  }

  for (const cb of qa<HTMLInputElement>(".plugin-perm-checkbox")) {
    cb.addEventListener("change", () => {
      const pluginId = cb.getAttribute("data-plugin-id");
      const permission = cb.getAttribute("data-permission");
      if (pluginId && permission) {
        handlers.onPermissionChange(pluginId, permission, cb.checked);
      }
    });
  }

  const idInput = q<HTMLInputElement>("#input-anim-id");
  const labelInput = q<HTMLInputElement>("#input-anim-label");
  const registerBtn = q<HTMLButtonElement>("#btn-register-anim");

  idInput?.addEventListener("input", () => {
    const canSubmit = handlers.onAnimIdInput(idInput.value);
    if (registerBtn) registerBtn.disabled = !canSubmit;
  });
  labelInput?.addEventListener("input", () => {
    handlers.onAnimLabelInput(labelInput.value);
  });
  q<HTMLButtonElement>("#btn-pick-anim-vrma")?.addEventListener(
    "click",
    handlers.onPickVrma
  );
  registerBtn?.addEventListener("click", handlers.onRegisterAnim);

  for (const btn of qa<HTMLButtonElement>(".btn-unregister-anim")) {
    btn.addEventListener("click", () => {
      const animId = btn.getAttribute("data-anim-id");
      if (animId) handlers.onUnregisterAnim(animId);
    });
  }
}
