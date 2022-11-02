import debug from 'debug';

export class Logger {
	private readonly _debug: debug.Debugger;
	private readonly _warn: debug.Debugger;
	private readonly _error: debug.Debugger;

	constructor(prefix?: string) {
		if (prefix) {
			this._debug = debug(`${process.title}:DEBUG:${prefix}`);
			this._warn = debug(`${process.title}:WARN:${prefix}`);
			this._error = debug(`${process.title}:ERROR:${prefix}`);
		} else {
			this._debug = debug(`${process.title}:DEBUG`);
			this._warn = debug(`${process.title}:WARN`);
			this._error = debug(`${process.title}:ERROR`);
		}

		/* eslint-disable no-console */
		this._debug.log = console.info.bind(console);
		this._warn.log = console.warn.bind(console);
		this._error.log = console.error.bind(console);
		/* eslint-enable no-console */
	}

	get debug(): debug.Debugger {
		return this._debug;
	}

	get warn(): debug.Debugger {
		return this._warn;
	}

	get error(): debug.Debugger {
		return this._error;
	}
}