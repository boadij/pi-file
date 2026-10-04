# pi-file

`/file` turns command text into temporary Markdown files and prepares them as
embedded Pi file context.

## Single file

```text
/file Hello World
```

This creates a temporary `hello-world.md` and prepares:

```xml
<file name="/tmp/pi-file-XXXXXX/hello-world.md" bytes="11" label="Hello World">
Hello World
</file>
```

The first usable ATX heading (`#` through `######`) determines the label and
filename. If there is no usable heading, the first non-empty line is used.

```text
/file Intro

### Authentication Failure
...
```

This produces `authentication-failure.md`.

## Multiple files

```text
/file # Request
GET /users

/file # Response
200 OK
```

Each top-level `/file` line starts another file. Separators are ignored inside
fenced Markdown code blocks. The first `/file` requires a space before its
content, such as `/file # Request`; a bare `/file` followed by a newline is not
valid syntax. A top-level literal `/file` line outside a fence is reserved
syntax.

`/file` prepares context in Pi's normal input editor but does not submit it. Add
any instructions you want, then press Enter to submit normally.

Files remain in the operating system's temporary directory. Cleanup by the
operating system is intentional.

## Install and develop

```sh
pi install git:github.com/boadij/pi-file
pi -e ./extensions/index.ts
npm test
npm pack --dry-run
```
