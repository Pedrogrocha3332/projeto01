const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
function load(path, deps = {}) {
  const context = {
    exports: {},
    require: (name) => {
      if (!(name in deps)) throw new Error("Unexpected dependency " + name);
      return deps[name];
    },
    crypto: require("node:crypto").webcrypto,
    TextEncoder,
    File,
    Blob,
    Uint8Array,
    Map,
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  );
  return context.exports;
}
const plan = load("src/lib/import-plan.ts");
test("agrupa perfis sem misturar subpastas e ignora capas e textos", () => {
  const rows = plan.groupImportFiles([
    { name: "10.mp4", size: 3, webkitRelativePath: "Downloads/ana/reels/10.mp4" },
    { name: "2.mp4", size: 3, webkitRelativePath: "Downloads/ana/reels/2.mp4" },
    { name: "1.mov", size: 4, webkitRelativePath: "Downloads/bia/reels/1.mov" },
    { name: "cover.jpg", size: 2 },
    { name: "caption.txt", size: 2 },
    { name: "empty.mp4", size: 0 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "ana");
  assert.equal(rows[1].name, "bia");
  assert.equal(rows[0].files[0].name, "2.mp4");
});
test("aceita somente origens HTTPS sem credenciais, mais localhost para teste", () => {
  assert.equal(plan.panelOrigin("https://painel.example/media?q=1"), "https://painel.example");
  for (const url of ["javascript:alert(1)", "http://example.com", "https://user:pass@example.com"])
    assert.throws(() => plan.panelOrigin(url));
});
test("IDs repetíveis por conteúdo, isolados por pasta e usuário", async () => {
  const file = new Blob(["video"]);
  const id = await plan.importAssetId("user", "folder", file);
  assert.equal(await plan.importAssetId("user", "folder", new Blob(["video"])), id);
  assert.notEqual(await plan.importAssetId("other", "folder", file), id);
  assert.notEqual(await plan.importAssetId("user", "other", file), id);
  assert.notEqual(await plan.importAssetId("user", "folder", new Blob(["other"])), id);
});
test("mensagens exigem origem, janela, canal e nonce exatos", () => {
  const bridge = load("src/lib/import-connection.ts", { "@/lib/import-plan": plan });
  const source = {};
  const event = {
    origin: "https://panel.example",
    source,
    data: { channel: bridge.IMPORT_CHANNEL, nonce: "nonce" },
  };
  assert.equal(bridge.validImportMessage(event, event.origin, source, "nonce"), true);
  assert.equal(bridge.validImportMessage(event, "https://evil.example", source, "nonce"), false);
  assert.equal(bridge.validImportMessage(event, event.origin, {}, "nonce"), false);
  assert.equal(bridge.validImportMessage(event, event.origin, source, "old"), false);
});
function fixture() {
  const rows = new Map(),
    objects = new Set();
  let failSave = true,
    uploads = 0;
  const storage = {
    upload: async (path) => {
      uploads++;
      if (objects.has(path)) return { error: { statusCode: "409", message: "exists" } };
      objects.add(path);
      return { error: null };
    },
    createSignedUrl: async (path) => ({
      data: { signedUrl: "https://storage.example/" + path },
      error: null,
    }),
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    storage: { from: () => storage },
    from: (table) => {
      let id;
      const q = {
        select: () => q,
        eq: (key, value) => {
          if (key === "id") id = value;
          return q;
        },
        order: () => q,
        limit: async () => ({ data: [{ id: "folder" }], error: null }),
        maybeSingle: async () => ({ data: rows.get(id) || null, error: null }),
        insert: async (row) => {
          rows.set(row.id, row);
          if (failSave) {
            failSave = false;
            return { error: { message: "response lost" } };
          }
          return { error: null };
        },
      };
      return q;
    },
  };
  const uploader = load("src/lib/import-upload.ts", {
    "@/integrations/supabase/client": { supabase },
    "@/lib/import-plan": plan,
    "@/lib/video-utils": {
      REEL_LIMITS: { maxBytes: 4 * 1024 ** 3 },
      extractVideoMeta: async () => ({ width: 720, height: 1280, duration: 10 }),
      generateVideoThumbnail: async () => new Blob(["thumb"]),
    },
  });
  return {
    uploader,
    rows,
    objects,
    get uploads() {
      return uploads;
    },
  };
}
test("resposta perdida após salvar: repetir não duplica nem reenvia", async () => {
  const f = fixture();
  const file = new File(["content"], "video.mp4", { type: "video/mp4" });
  await assert.rejects(
    f.uploader.uploadImportedVideo(file, { id: "folder", name: "Folder" }),
    /response lost/,
  );
  assert.equal(f.rows.size, 1);
  const before = f.uploads;
  const result = await f.uploader.uploadImportedVideo(file, { id: "folder", name: "Folder" });
  assert.equal(result.duplicate, true);
  assert.equal(f.rows.size, 1);
  assert.equal(f.uploads, before);
  const row = [...f.rows.values()][0];
  assert.equal(row.folder_id, "folder");
  assert.equal(row.ig_account_id, null);
  assert.equal(row.media_kind, "video");
});
test("rejeita fotos e arquivos vazios sem upload", async () => {
  const f = fixture();
  await assert.rejects(
    f.uploader.uploadImportedVideo(new File(["x"], "cover.jpg"), { name: "Folder" }),
  );
  await assert.rejects(
    f.uploader.uploadImportedVideo(new File([], "empty.mp4"), { name: "Folder" }),
  );
  assert.equal(f.uploads, 0);
});
