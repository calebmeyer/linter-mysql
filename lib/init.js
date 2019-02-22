'use babel';

// eslint-disable-next-line import/no-extraneous-dependencies, import/extensions
import { CompositeDisposable } from 'atom';

let helpers;

// An example regex to extract line, col and message from dummy output
// This is a dummy output:10:5: with an error
const REGEX = /.+?:(\d+):(\d+):\s(.*)/g;

// Load needed dependencies for your linter
const loadDeps = () => {
  if (!helpers) {
    helpers = require('atom-linter');
  }
};

// Parse the dummy output and return a formatted message to the AtomLinter
const parseSqlLintOutput = (output, file, editor) => {
  const messages = [];
  let match = REGEX.exec(output);
  while (match !== null) {
    // match regex group 1
    const line = Number.parseInt(match[1], 10) - 1;
    // match regex group 2
    const col = Number.parseInt(match[2], 10) - 2;
    messages.push({
      severity: 'error',
      // match regex group 3
      excerpt: match[3],
      location: {
        file,
        position: helpers.generateRange(editor, line, col),
      },
    });
    match = REGEX.exec(output);
  }
  return messages;
};

module.exports = {
  // activates the linter
  activate() {
    this.idleCallbacks = new Set();
    let depsCallbackID;
    const installLinterDeps = () => {
      this.idleCallbacks.delete(depsCallbackID);
      if (!atom.inSpecMode()) {
        require('atom-package-deps').install('sql-lint');
      }
      loadDeps();
    };
    depsCallbackID = window.requestIdleCallback(installLinterDeps);
    this.idleCallbacks.add(depsCallbackID);

    // subscribe events for configuration options (check package.json configSchema)
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      atom.config.observe(
        'linter-mysql.executablePath',
        (value) => { this.executablePath = value; },
      ),
      atom.config.observe(
        'linter-mysql.extraOptions',
        (value) => { this.extraOptions = value; },
      ),
    );
  },

  // deactivates the linter
  deactivate() {
    this.idleCallbacks.forEach(callbackID => window.cancelIdleCallback(callbackID));
    this.idleCallbacks.clear();
    this.subscriptions.dispose();
  },

  // returns the linter provider to AtomLinter
  provideLinter() {
    return {
      name: 'sql-lint', // the name of the lint tool
      grammarScopes: ['source.sql'], // the grammar source (an atom language usually)
      scope: 'file',
      lintsOnChange: false, // lints on the fly or on save only
      lint: async (editor) => {
        if (!atom.workspace.isTextEditor(editor)) {
          // If we somehow get fed an invalid TextEditor just immediately return
          return null;
        }

        // the actual opened file
        const filePath = editor.getPath();
        if (!filePath) {
          return null;
        }

        loadDeps();

        // arguments passed to dummy lint tool (depends on your tool options)
        const args = [];

        args.push(filePath);

        if (this.extraOptions.length > 0) {
          args.push(this.extraOptions);
        }

        const execOptions = {
          stream: 'stderr', // the output receiver of the lint process
          uniqueKey: `linter-mysql::${filePath}`,
          allowEmptyStderr: true,
        };

        let output;
        try {
          // the output from stderr after calling dummy
          // TODO: figure out how to make this use the library instead
          output = await helpers.exec(this.executablePath, args, execOptions);
        } catch (e) {
          // Message dialog on execution timeout
          if (e.message === 'Process execution timed out') {
            atom.notifications.addInfo('linter-mysql: `sql-lint` timed out', {
              description: 'A timeout occured while executing `sql-lint`, it could be due to lower resources '
                           + 'or a temporary overload.',
            });
          } else {
            // An unexpected error dialog
            atom.notifications.addError('linter-mysql: Unexpected error', { description: e.message });
          }
          return null;
        }

        // Process was canceled by newer process
        if (output === null) { return null; }

        // Parse the output
        return parseSqlLintOutput(output, filePath, editor);
      },
    };
  },
};
