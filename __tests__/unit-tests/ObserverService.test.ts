import { JsonlFileSink } from '@observertc/observer-js';
import { access, mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ObservedCallAppData, ObserverService } from '../../src/ObserverService';
import { Uploader, UploadOptions } from '../../src/uploader/Uploader';

const stubUploader = (deleteAfterUpload: boolean, fail = false) => {
	const calls: UploadOptions[] = [];
	const uploader: Uploader = {
		deleteAfterUpload,
		upload: async (options: UploadOptions) => {
			calls.push(options);

			if (fail) throw new Error('upload boom');
		},
	};

	return { uploader, calls };
};

/** Poll rather than sleep, so we do not race the sink's async close handling. */
const until = async (check: () => Promise<boolean>, timeoutMs = 3000): Promise<boolean> => {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (await check()) return true;

		await new Promise((resolve) => setTimeout(resolve, 10));
	}

	return false;
};

const exists = async (path: string): Promise<boolean> => {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
};

/** Drive one client sink through create -> close, as the observer would. */
const runSinkLifecycle = async (uploader: Uploader) => {
	const directory = await mkdtemp(join(tmpdir(), 'observer-service-'));
	const sourcePath = join(directory, 'client.jsonl');

	await writeFile(sourcePath, '{"n":1}\n');

	const service = new ObserverService({ samplesStorePath: directory, uploader });
	const sink = new JsonlFileSink({ path: sourcePath });
	const scope = {
		sink,
		observedCall: { callId: 'call-1', appData: { roomId: 'room-1' } },
		observedClient: { clientId: 'client-1', attachments: {} },
	};

	service.emit('client-sink-created', scope as never);
	sink.end();

	return { sourcePath };
};

describe('ObserverService - uploader wiring', () => {
	test('discards an uploader that has no directory to read from', () => {
		const { uploader } = stubUploader(false);
		const service = new ObserverService({ uploader });

		expect(service.options.uploader).toBeUndefined();
		expect(service.listenerCount('call-closed')).toBe(0);
	});

	test('subscribes to the artifact events only when uploading', () => {
		const { uploader } = stubUploader(false);
		const withUploader = new ObserverService({ samplesStorePath: tmpdir(), uploader });
		const without = new ObserverService({ samplesStorePath: tmpdir() });

		for (const event of [ 'client-sink-created', 'client-added', 'client-updated', 'call-closed', 'mediasoup-router-removed' ]) {
			expect(withUploader.listenerCount(event as never)).toBe(1);
			expect(without.listenerCount(event as never)).toBe(0);
		}

		// Diagnostics stay wired either way.
		expect(without.listenerCount('peer-connection-added' as never)).toBe(1);
	});
});

describe('ObserverService - staged file cleanup', () => {
	test('uploads the sink file under the room/call/client key', async () => {
		const { uploader, calls } = stubUploader(false);
		const { sourcePath } = await runSinkLifecycle(uploader);

		expect(await until(async () => calls.length > 0)).toBe(true);
		expect(calls[0]).toMatchObject({
			key: 'room-1/call-1/client-1.jsonl',
			sourcePath,
			contentType: 'application/x-ndjson',
		});
	});

	test('deletes the file when the uploader asks for it', async () => {
		const { uploader, calls } = stubUploader(true);
		const { sourcePath } = await runSinkLifecycle(uploader);

		expect(await until(async () => calls.length > 0)).toBe(true);
		expect(await until(async () => !(await exists(sourcePath)))).toBe(true);
	});

	test('keeps the file when deleteAfterUpload is off', async () => {
		const { uploader, calls } = stubUploader(false);
		const { sourcePath } = await runSinkLifecycle(uploader);

		expect(await until(async () => calls.length > 0)).toBe(true);

		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(await exists(sourcePath)).toBe(true);
	});

	test('keeps the file when the upload failed, even with deletion on', async () => {
		const { uploader, calls } = stubUploader(true, true);
		const { sourcePath } = await runSinkLifecycle(uploader);

		expect(await until(async () => calls.length > 0)).toBe(true);

		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(await exists(sourcePath)).toBe(true);
	});
});

/** Minimal stand-ins for the observer scopes; only the fields the handlers read. */
type CallScope = {
	callId: string;
	numberOfIssues: number;
	clientsUsedTurn: Set<string>;
	appData: ObservedCallAppData;
};

const callScope = (overrides: Partial<CallScope> = {}): CallScope => ({
	callId: 'call-1',
	numberOfIssues: 2,
	clientsUsedTurn: new Set([ 'client-1' ]),
	appData: { roomId: 'room-1', clients: {}, routerIds: [] },
	...overrides,
});

describe('ObserverService - appData bookkeeping', () => {
	const service = () => new ObserverService({ samplesStorePath: tmpdir(), uploader: stubUploader(false).uploader });

	test('client-added seeds the client entry', () => {
		const svc = service();
		const observedCall = callScope();

		svc.emit('client-added', { observedCall, observedClient: { clientId: 'client-1' } } as never);

		expect(observedCall.appData.clients).toHaveProperty('client-1');
	});

	test('client-updated lifts roomId and displayName off the attachments', () => {
		const svc = service();
		const observedCall = callScope({ appData: { roomId: undefined, clients: { 'client-1': {} }, routerIds: [] } });
		const observedClient = {
			clientId: 'client-1',
			call: observedCall,
			attachments: { roomId: 'room-9', displayName: 'Ada' },
		};

		svc.emit('client-updated', { observedClient } as never);

		expect(observedCall.appData.roomId).toBe('room-9');
		expect(observedCall.appData.clients['client-1']).toEqual({ displayName: 'Ada' });
	});

	test('router matching tags the client and records the router on the call', () => {
		const svc = service();
		const observedCall = callScope();
		const injectAttachment = jest.fn();
		const observedMediasoupRouter = { router: { id: 'router-1' }, appData: undefined as unknown };

		svc.emit('mediasoup-router-matched-with-peer-connection', {
			observedClient: { clientId: 'client-1', injectAttachment },
			observedCall,
			observedMediasoupRouter,
		} as never);

		expect(injectAttachment).toHaveBeenCalledWith({ routerId: 'router-1' });
		expect(observedCall.appData.routerIds).toEqual([ 'router-1' ]);
		expect(observedMediasoupRouter.appData).toEqual({ observedCall });
	});

	test('router matching does not record the same router twice', () => {
		const svc = service();
		const observedCall = callScope();
		const scope = {
			observedClient: { clientId: 'client-1', injectAttachment: jest.fn() },
			observedCall,
			observedMediasoupRouter: { router: { id: 'router-1' }, appData: undefined as unknown },
		};

		svc.emit('mediasoup-router-matched-with-peer-connection', scope as never);
		svc.emit('mediasoup-router-matched-with-peer-connection', scope as never);

		expect(observedCall.appData.routerIds).toEqual([ 'router-1' ]);
	});
});

describe('ObserverService - summary and router uploads', () => {
	test('call-closed uploads the summary with issues and turn usage', async () => {
		const { uploader, calls } = stubUploader(false);
		const svc = new ObserverService({ samplesStorePath: tmpdir(), uploader });

		svc.emit('call-closed', { observedCall: callScope() } as never);

		expect(await until(async () => calls.length > 0)).toBe(true);
		expect(calls[0].key).toBe('room-1/call-1/call-summary.json');
		expect(calls[0].contentType).toBe('application/json');
		expect(JSON.parse(String(calls[0].body))).toMatchObject({
			roomId: 'room-1',
			numberOfIssues: 2,
			clientsUsedTurn: [ 'client-1' ],
		});
	});

	test('call-closed falls back to unknown-room', async () => {
		const { uploader, calls } = stubUploader(false);
		const svc = new ObserverService({ samplesStorePath: tmpdir(), uploader });

		svc.emit('call-closed', { observedCall: callScope({ appData: { roomId: undefined, clients: {}, routerIds: [] } }) } as never);

		expect(await until(async () => calls.length > 0)).toBe(true);
		expect(calls[0].key).toBe('unknown-room/call-1/call-summary.json');
	});

	test('router-removed uploads the router sample', async () => {
		const { uploader, calls } = stubUploader(false);
		const svc = new ObserverService({ samplesStorePath: tmpdir(), uploader });

		svc.emit('mediasoup-router-removed', {
			observedMediasoupRouter: {
				router: { id: 'router-1' },
				sample: { some: 'stats' },
				appData: { observedCall: callScope() },
			},
		} as never);

		expect(await until(async () => calls.length > 0)).toBe(true);
		expect(calls[0].key).toBe('room-1/call-1/mediasoup-router-router-1.json');
		expect(JSON.parse(String(calls[0].body))).toEqual({ some: 'stats' });
	});

	test('router-removed skips a router that was never matched to a call', async () => {
		const { uploader, calls } = stubUploader(false);
		const svc = new ObserverService({ samplesStorePath: tmpdir(), uploader });

		svc.emit('mediasoup-router-removed', {
			observedMediasoupRouter: { router: { id: 'router-1' }, sample: {}, appData: undefined },
		} as never);

		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(calls).toHaveLength(0);
	});

	test('diagnostic handlers do not throw', () => {
		const svc = new ObserverService({ samplesStorePath: tmpdir() });

		expect(() => svc.emit('peer-connection-added', {
			observedCall: callScope(),
			observedClient: { clientId: 'client-1' },
			observedPeerConnection: { peerConnectionId: 'pc-1' },
		} as never)).not.toThrow();

		expect(() => svc.emit('mediasoup-router-added', {
			observedMediasoupRouter: { router: { id: 'router-1' }, sample: {} },
		} as never)).not.toThrow();
	});
});

describe('ObserverService - addDataConsumer', () => {
	/* eslint-disable-next-line no-unused-vars */
	type MessageHandler = (payload: Buffer | string) => void;

	const fakeDataConsumer = () => {
		const handlers: Record<string, MessageHandler> = {};

		return {
			id: 'dc-1',
			on: jest.fn((event: string, handler: MessageHandler) => {
				handlers[event] = handler;
			}),
			off: jest.fn(),
			observer: { once: jest.fn() },
			handlers,
		};
	};

	test('subscribes to messages and unsubscribes when the consumer closes', () => {
		const svc = new ObserverService({});
		const dataConsumer = fakeDataConsumer();

		svc.addDataConsumer(dataConsumer as never);

		expect(dataConsumer.on).toHaveBeenCalledWith('message', expect.any(Function));
		expect(dataConsumer.observer.once).toHaveBeenCalledWith('close', expect.any(Function));

		// Fire the registered close handler and confirm it detaches the listener.
		(dataConsumer.observer.once.mock.calls[0][1] as () => void)();
		expect(dataConsumer.off).toHaveBeenCalledWith('message', expect.any(Function));
	});

	test('survives a payload that is not valid JSON', () => {
		const svc = new ObserverService({});
		const dataConsumer = fakeDataConsumer();

		svc.addDataConsumer(dataConsumer as never);

		expect(() => dataConsumer.handlers.message(Buffer.from('not json'))).not.toThrow();
		expect(() => dataConsumer.handlers.message('also not json')).not.toThrow();
	});
});
