# SQLite

<!--introduced_in=v22.5.0-->

<!-- YAML
added: v22.5.0
-->

> Stability: 1.1 - Active development.

<!-- source_link=lib/sqlite.js -->

The `node:sqlite` module facilitates working with SQLite databases.
To access it:

```mjs
import sqlite from 'node:sqlite';
```

```cjs
const sqlite = require('node:sqlite');
```

This module is only available under the `node:` scheme.

The following example shows the basic usage of the `node:sqlite` module to open
an in-memory database, write data to the database, and then read the data back.

```mjs
import { DatabaseSync } from 'node:sqlite';
const database = new DatabaseSync(':memory:');

// Execute SQL statements from strings.
database.exec(`
  CREATE TABLE data(
    key INTEGER PRIMARY KEY,
    value TEXT
  ) STRICT
`);
// Create a prepared statement to insert data into the database.
const insert = database.prepare('INSERT INTO data (key, value) VALUES (?, ?)');
// Execute the prepared statement with bound values.
insert.run(1, 'hello');
insert.run(2, 'world');
// Create a prepared statement to read data from the database.
const query = database.prepare('SELECT * FROM data ORDER BY key');
// Execute the prepared statement and log the result set.
console.log(query.all());
// Prints: [ { key: 1, value: 'hello' }, { key: 2, value: 'world' } ]
```

```cjs
'use strict';
const { DatabaseSync } = require('node:sqlite');
const database = new DatabaseSync(':memory:');

// Execute SQL statements from strings.
database.exec(`
  CREATE TABLE data(
    key INTEGER PRIMARY KEY,
    value TEXT
  ) STRICT
`);
// Create a prepared statement to insert data into the database.
const insert = database.prepare('INSERT INTO data (key, value) VALUES (?, ?)');
// Execute the prepared statement with bound values.
insert.run(1, 'hello');
insert.run(2, 'world');
// Create a prepared statement to read data from the database.
const query = database.prepare('SELECT * FROM data ORDER BY key');
// Execute the prepared statement and log the result set.
console.log(query.all());
// Prints: [ { key: 1, value: 'hello' }, { key: 2, value: 'world' } ]
```

## Class: `DatabaseSync`

<!-- YAML
added: v22.5.0
-->

This class represents a single [connection][] to a SQLite database. All APIs
exposed by this class execute synchronously.

### `new DatabaseSync(location[, options])`

<!-- YAML
added: v22.5.0
-->

* `location` {string} The location of the database. A SQLite database can be
  stored in a file or completely [in memory][]. To use a file-backed database,
  the location should be a file path. To use an in-memory database, the location
  should be the special name `':memory:'`.
* `options` {Object} Configuration options for the database connection. The
  following options are supported:
  * `open` {boolean} If `true`, the database is opened by the constructor. When
    this value is `false`, the database must be opened via the `open()` method.
    **Default:** `true`.
  * `readOnly` {boolean} If `true`, the database is opened in read-only mode.
    If the database does not exist, opening it will fail. **Default:** `false`.
  * `enableForeignKeyConstraints` {boolean} If `true`, foreign key constraints
    are enabled. This is recommended but can be disabled for compatibility with
    legacy database schemas. The enforcement of foreign key constraints can be
    enabled and disabled after opening the database using
    [`PRAGMA foreign_keys`][]. **Default:** `true`.
  * `enableDoubleQuotedStringLiterals` {boolean} If `true`, SQLite will accept
    [double-quoted string literals][]. This is not recommended but can be
    enabled for compatibility with legacy database schemas.
    **Default:** `false`.
  * `allowExtension` {boolean} If `true`, the `loadExtension` SQL function
    and the `loadExtension()` method are enabled.
    You can call `enableLoadExtension(false)` later to disable this feature.
    **Default:** `false`.

Constructs a new `DatabaseSync` instance.

### `database.close()`

<!-- YAML
