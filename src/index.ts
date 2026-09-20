import { config } from "../package.json";
import Addon from "./addon";

const zoteroWithPlugin = Zotero as _ZoteroTypes.Zotero & {
  [key: string]: unknown;
};

if (!zoteroWithPlugin[config.addonInstance]) {
  _globalThis.addon = new Addon();
  zoteroWithPlugin[config.addonInstance] = addon;
}
