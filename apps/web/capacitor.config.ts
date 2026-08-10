import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.rspratas.app",
  appName: "RS Pratas",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
