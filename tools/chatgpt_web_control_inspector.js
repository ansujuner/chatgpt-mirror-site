/*
 * ChatGPT Web model/request inspector (2026-08-31 snapshot).
 *
 * Paste into DevTools Console on an already-signed-in https://chatgpt.com page.
 * It never prints the access token, cookies, request headers, or message text.
 */
(async () => {
  const sessionResponse = await fetch("/api/auth/session", {
    credentials: "include",
    cache: "no-store",
  });
  const session = await sessionResponse.json();
  if (!session?.accessToken) throw new Error("ChatGPT session is not signed in");

  const authHeaders = { Authorization: `Bearer ${session.accessToken}` };
  const paths = [
    "/backend-api/models?iim=false&is_gizmo=false&supports_model_picker_upgrade_presets=true",
    "/backend-api/tpp/models/?supports_model_picker_upgrade_presets=true",
  ];

  for (const path of paths) {
    const response = await fetch(path, {
      credentials: "include",
      headers: authHeaders,
    });
    if (!response.ok) {
      console.info(`[models] ${path}: HTTP ${response.status}`);
      continue;
    }
    const payload = await response.json();
    console.group(`[models] ${path}; default=${payload.default_model_slug}`);
    console.table(
      (payload.models || []).map((model) => ({
        slug: model.slug,
        title: model.title,
        reasoning_type: model.reasoning_type,
        configurable: !!model.configurable_thinking_effort,
        default_effort: model.default_thinking_effort ?? "(omitted)",
        allowed_efforts: (model.thinking_efforts || [])
          .map((item) =>
            typeof item === "string" ? item : item.thinking_effort,
          )
          .join(","),
      })),
    );
    console.table(
      (payload.versions || []).flatMap((version) =>
        (version.intelligence_presets || []).map((preset) => ({
          version: version.id,
          picker_title: preset.title,
          lane: preset.lane,
          model: preset.model_slug,
          thinking_effort: preset.thinking_effort ?? "(omitted)",
          service_tiers: (preset.service_tier_options || [])
            .map((item) => item.service_tier)
            .join(","),
        })),
      ),
    );
    console.groupEnd();
  }

  if (!globalThis.__chatRequestControlInspectorInstalled) {
    globalThis.__chatRequestControlInspectorInstalled = true;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async function inspectedFetch(input, init = {}) {
      const url = typeof input === "string" ? input : input?.url || "";
      if (
        /\/backend-api\/f\/conversation(?:\/prepare)?(?:\?|$)/.test(url)
      ) {
        try {
          const rawBody =
            init?.body ??
            (input instanceof Request ? await input.clone().text() : "");
          const body =
            typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;

          // Deliberately omit messages, partial_query, browser context, and all
          // headers so the console cannot leak prompts or credentials.
          console.table([
            {
              endpoint: new URL(url, location.origin).pathname,
              action: body?.action,
              model: body?.model,
              requested_default_model:
                body?.requested_default_model ?? "(omitted)",
              thinking_effort: body?.thinking_effort ?? "(omitted)",
              service_tier: body?.service_tier ?? "(omitted)",
              conversation_mode:
                body?.conversation_mode?.kind ?? "(omitted)",
              system_hints: Array.isArray(body?.system_hints)
                ? body.system_hints.join(",")
                : "",
              one_off_model_override:
                body?.one_off_model_override ?? "(omitted)",
            },
          ]);
        } catch {
          console.debug("[request controls] body was not JSON");
        }
      }
      return originalFetch.apply(this, arguments);
    };
  }

  console.info(
    "ChatGPT Web control inspector installed. Send a message to observe only model/effort fields.",
  );
})();
