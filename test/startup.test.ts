import { assert } from "chai";
import { config } from "../package.json";
import { COLUMN_KEY } from "../src/modules/alphaxiv";

describe("startup", function () {
  it("defines and initializes the plugin instance", function () {
    const instance = Zotero[config.addonInstance] as typeof addon;
    assert.isNotEmpty(instance);
    assert.isTrue(instance.data.initialized);
  });

  it("registers the alphaXiv Likes item-tree column", function () {
    const columns = Zotero.ItemTreeManager.getCustomColumns();
    assert.isTrue(
      columns.some(
        (column) =>
          column.pluginID === config.addonID &&
          column.dataKey.endsWith(COLUMN_KEY),
      ),
    );
  });
});
