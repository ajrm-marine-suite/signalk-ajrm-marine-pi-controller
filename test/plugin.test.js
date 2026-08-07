const assert = require("node:assert/strict");
const test = require("node:test");

const createPlugin = require("../plugin");

test("privileged actions require Signal K write access", async () => {
  const routes = new Map();
  const plugin = createPlugin(fakeApp());
  plugin.registerWithRouter(routerMap(routes));

  for (const path of [
    "/actions/reboot",
    "/actions/shutdown",
    "/actions/install-piper",
    "/actions/backup-sd-card",
  ]) {
    const response = await invoke(routes, "POST", path, {
      body: { confirmed: true },
      skIsAuthenticated: false,
      skPrincipal: { permissions: "readonly" },
    });
    assert.equal(response.statusCode, 403);
    assert.match(response.body.error, /read\/write or administrator/);
  }
});

test("power and installer actions still require explicit confirmation", async () => {
  const routes = new Map();
  const plugin = createPlugin(fakeApp());
  plugin.registerWithRouter(routerMap(routes));

  for (const path of ["/actions/reboot", "/actions/shutdown", "/actions/install-piper"]) {
    const response = await invoke(routes, "POST", path, { body: { confirmed: false } });
    assert.equal(response.statusCode, 400);
    assert.match(response.body.error, /Confirmation/);
  }
});

test("OpenAPI paths match the registered HTTP API", () => {
  const routes = new Map();
  const plugin = createPlugin(fakeApp());
  plugin.registerWithRouter(routerMap(routes));
  const api = plugin.getOpenApi();
  const documented = Object.entries(api.paths).flatMap(([path, pathItem]) => {
    const resolved = pathItem.$ref
      ? api.components.pathItems[pathItem.$ref.split("/").at(-1)]
      : pathItem;
    return ["get", "post"]
      .filter((method) => resolved[method])
      .map((method) => `${method.toUpperCase()} ${path}`);
  });
  assert.deepEqual([...routes.keys()].sort(), documented.sort());
});

function fakeApp() {
  return {
    debug() {},
    error() {},
    setPluginStatus() {},
    handleMessage() {},
  };
}

function routerMap(routes) {
  return {
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); },
  };
}

async function invoke(routes, method, path, request = {}) {
  const response = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await routes.get(`${method} ${path}`)({ body: {}, ...request }, response);
  return response;
}
