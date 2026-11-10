// Settings from src/appmeta/settings.json, with code defaults when the runtime has none.
// Values only change when the app restarts (the bar applies edits on the next start).
// Nothing secret lives here: the GitHub side runs on the Mac relay.
import { device } from "@shared/device";
import { loadValues, type SettingsValues } from "@shared/settings";

export type Config = {
  relay: string;
  demo: boolean;
  chime: boolean;
};

const DEFAULTS: Config = { relay: "http://10.0.4.21:8787", demo: false, chime: false };

export async function loadConfig(appId: string): Promise<Config> {
  let values: SettingsValues | null = await loadValues();
  if (!values) {
    try {
      values = ((await device.AppsSettingsGet({ app_id: appId })) as { values?: SettingsValues }).values ?? null;
    } catch {
      values = null;
    }
  }
  if (!values) return DEFAULTS;
  const relay = typeof values.relay === "string" ? values.relay.trim().replace(/\/+$/, "") : "";
  return {
    relay: /^http:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(relay) ? relay : DEFAULTS.relay,
    demo: values.demo === true,
    chime: values.chime === true,
  };
}
