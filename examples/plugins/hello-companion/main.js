/* global window, console */
(() => {
  "use strict";

  const CHANNEL = "deskumi:plugin";
  const PROTOCOL_VERSION = 1;
  let pluginId = "hello-companion";
  let grantedScopes = new Set();
  let availableExpressions = new Set();
  let msgSeq = 0;

  function nextId(prefix) {
    msgSeq += 1;
    return `${prefix}-${msgSeq}`;
  }

  function sendCommand(cmd, prefix) {
    window.parent.postMessage(
      {
        channel: CHANNEL,
        pluginId,
        v: PROTOCOL_VERSION,
        id: nextId(prefix || cmd.type),
        cmd
      },
      "*"
    );
  }

  function hasScope(scope) {
    return grantedScopes.has(scope);
  }

  function sendExpressionIfAllowed(name, intensity, durationMs) {
    if (!hasScope("avatar:expression")) return;
    if (availableExpressions.size > 0 && !availableExpressions.has(name)) {
      return;
    }
    sendCommand(
      {
        type: "expression",
        name,
        intensity,
        durationMs,
        policy: "interrupt"
      },
      "expr"
    );
  }

  function sendSayIfAllowed(text, durationMs) {
    if (!hasScope("avatar:speak")) return;
    sendCommand(
      {
        type: "say",
        text,
        durationMs,
        policy: "interrupt"
      },
      "say"
    );
  }

  function handleClickEvent(region) {
    if (region === "head") {
      sendExpressionIfAllowed("surprised", 0.9, 1800);
      sendSayIfAllowed("Whoa! Careful with my head!", 2200);
      return;
    }

    sendExpressionIfAllowed("happy", 0.9, 1800);
    sendSayIfAllowed("Hello! Nice to meet you!", 2200);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.channel !== CHANNEL || data.v !== PROTOCOL_VERSION) return;

    if (typeof data.pluginId === "string" && data.pluginId.length > 0) {
      pluginId = data.pluginId;
    }

    switch (data.type) {
      case "init":
        grantedScopes = new Set(Array.isArray(data.scopes) ? data.scopes : []);
        availableExpressions = new Set(
          Array.isArray(data.expressions) ? data.expressions : []
        );
        sendCommand(
          {
            type: "hello",
            clientName: "hello-companion",
            clientVersion: "0.1.0",
            events: ["click"]
          },
          "hello"
        );
        break;
      case "permissionsChanged":
        grantedScopes = new Set(Array.isArray(data.scopes) ? data.scopes : []);
        break;
      case "click":
        handleClickEvent(data.region === "head" ? "head" : "body");
        break;
      case "error":
        console.warn(
          `[${pluginId}] command error (${data.code}): ${data.message}`
        );
        break;
      default:
        break;
    }
  });
})();
