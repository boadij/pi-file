import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { basename, dirname } from "node:path";
import piFile from "../extensions/index.ts";

function register() {
  let command;
  piFile({
    registerCommand(name, definition) {
      assert.equal(name, "file");
      command = definition;
    },
    sendUserMessage() {
      assert.fail("/file must not submit directly");
    },
  });
  return command;
}

test("/file splits fenced multi-file input and embeds exact file contents", async () => {
  const command = register();
  const pastes = [];
  const notices = [];
  const args =
    '# First File\r\nalpha é & "<\r\n\r\n```text\r\n/file not-a-separator\r\n````\r\n\r\n~~~~text\r\n/file tilde-literal\r\n~~~~~\r\n\r\n/file ### Duplicate\r\nbeta\r\n\r\n/file ### Duplicate\r\ngamma\r\n\r\n/file # CON\r\nreserved\r\n\r\n/file # A & " <B>\r\nlast';

  await command.handler(args, {
    mode: "tui",
    ui: {
      notify: (...notice) => notices.push(notice),
      pasteToEditor: (text) => pastes.push(text),
    },
  });

  const prepared = pastes[0];
  const tags = [
    ...prepared.matchAll(
      /<file name="([^"]+)" bytes="(\d+)" label="([^"]*)">\n([\s\S]*?)\n<\/file>/g,
    ),
  ];
  const paths = tags.map((tag) => tag[1]);
  try {
    assert.equal(pastes.length, 2);
    assert.equal(pastes[1], "\n");
    assert.deepEqual(notices, []);
    assert.deepEqual(paths.map((path) => basename(path)), [
      "first-file.md",
      "duplicate.md",
      "duplicate-2.md",
      "text-4.md",
      "a-b.md",
    ]);
    assert.equal(tags.length, 5);
    assert.deepEqual(tags.map((tag) => tag[3]), [
      "First File",
      "Duplicate",
      "Duplicate",
      "CON",
      "A &amp; &quot; &lt;B>",
    ]);
    assert.deepEqual(tags.map((tag) => Number(tag[2])), [
      Buffer.byteLength(args.slice(0, args.indexOf("\r\n/file ### Duplicate"))),
      Buffer.byteLength("### Duplicate\r\nbeta\r\n"),
      Buffer.byteLength("### Duplicate\r\ngamma\r\n"),
      Buffer.byteLength("# CON\r\nreserved\r\n"),
      Buffer.byteLength('# A & " <B>\r\nlast'),
    ]);
    assert.ok(
      tags[0][4].includes(
        'alpha é & "<\r\n\r\n```text\r\n/file not-a-separator\r\n````\r\n\r\n~~~~text\r\n/file tilde-literal\r\n~~~~~',
      ),
    );
    assert.ok(tags[0][4].includes("/file not-a-separator"));
    assert.ok(tags[0][4].includes("/file tilde-literal"));
    assert.equal(tags[0][3], "First File");
    assert.match(prepared, /label="First File"/);
    assert.equal(await readFile(paths[0], "utf8"), tags[0][4]);
    assert.equal(await readFile(paths[1], "utf8"), "### Duplicate\r\nbeta\r\n");
    assert.equal(
      await readFile(paths[2], "utf8"),
      "### Duplicate\r\ngamma\r\n",
    );
    assert.equal(await readFile(paths[3], "utf8"), "# CON\r\nreserved\r\n");
    assert.equal(await readFile(paths[4], "utf8"), '# A & " <B>\r\nlast');
    assert.match(prepared, /label="A &amp; &quot; &lt;B>"/);
    assert.match(prepared, /label="First File"[\s\S]*alpha é & "</);
    assert.equal((prepared.match(/<file /g) ?? []).length, 5);
  } finally {
    if (paths[0]) await rm(dirname(paths[0]), { recursive: true, force: true });
  }
});

test("empty request warns without creating files or pasting", async () => {
  const command = register();
  const notices = [];
  const pastes = [];
  await command.handler(" \r\n", {
    mode: "rpc",
    ui: {
      notify: (...notice) => notices.push(notice),
      pasteToEditor: (text) => pastes.push(text),
    },
  });
  assert.deepEqual(notices, [["Nothing to file.", "warning"]]);
  assert.deepEqual(pastes, []);
});

test("an empty later file rejects all output before writing", async () => {
  const command = register();
  const notices = [];
  const pastes = [];
  await command.handler("Hello\n\n/file   ", {
    mode: "rpc",
    ui: {
      notify: (...notice) => notices.push(notice),
      pasteToEditor: (text) => pastes.push(text),
    },
  });
  assert.deepEqual(notices, [["File 2 is empty.", "warning"]]);
  assert.deepEqual(pastes, []);
});
