import pkg, { config } from "../package.json";
import hooks from "./hooks";
import { createPluginAPI, type AlphaLikesAPI } from "./modules/api";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized: boolean;
  };

  public hooks: typeof hooks;
  public api: AlphaLikesAPI;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
    };
    this.hooks = hooks;
    this.api = createPluginAPI(pkg.version);
  }
}

export default Addon;
