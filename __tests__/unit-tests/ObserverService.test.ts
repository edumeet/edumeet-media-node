import { JsonlFileSink } from '@observertc/observer-js';
import * as mediasoup from 'mediasoup';
import { access, mkdir, mkdtemp, readdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ObservedCallAppData, ObserverService } from '../../src/ObserverService';
import { Uploader, UploadOptions } from '../../src/uploader/Uploader';

const stubUploader = (deleteAfterUpload: boolean, fail = false, stored?: Record<string, number>) => {
	const calls: UploadOptions[] = [];
	const uploader: Uploader = {
		deleteAfterUpload,
		upload: async (options: UploadOptions) => {
			calls.push(options);

			if (fail) throw new Error('upload boom');
		},
		...(stored && { head: async (key: string) => (key in stored ? { size: stored[key] } : undefined) }),
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
const runSinkLifecycle = async (uploader: Uploader, appData: Partial<ObservedCallAppData> = { tenantFqdn: 'rooms.example.org', roomId: 'room-1' }, fileName = 'client.jsonl') => {
	const directory = await mkdtemp(join(tmpdir(), 'observer-service-'));
	const sourcePath = join(directory, fileName);

	await writeFile(sourcePath, '{"n":1}\n');

	const service = new ObserverService({ samplesStorePath: directory, uploader });
	const sink = new JsonlFileSink({ path: sourcePath });
	const scope = {
		sink,
		observedCall: { callId: 'call-1', appData },
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

		// The library may add its own internal listeners, so compare the delta
		// (our subscriptions) rather than the absolute count.
		for (const event of [ 'client-sink-created', 'client-added', 'client-updated', 'call-closed', 'mediasoup-router-removed' ]) {
			const delta = withUploader.listenerCount(event as never) - without.listenerCount(event as never);

			expect(delta).toBe(1);
		}

		// Diagnostics stay wired either way.
		expect(without.listenerCount('peer-connection-added' as never)).toBeGreaterThanOrEqual(1);
	});
});

describe('ObserverService - options handling', () => {
	test('never writes to the options object it was handed', () => {
		const { uploader } = stubUploader(false);
		const options = { uploader };
		const service = new ObserverService(options);

		// The uploader is dropped for want of a store path, but only internally:
		// the caller may well reuse this object for a second service.
		expect(options.uploader).toBe(uploader);
		expect(service.options).not.toBe(options);
		expect(service.options.uploader).toBeUndefined();
	});

	// minimist yields `true` for a valueless `--samplesStorePath`, and handing
	// that to the file sink factory used to take the node down at startup.
	test('disables storage for a valueless --samplesStorePath instead of throwing', () => {
		const { uploader } = stubUploader(false);
		const service = new ObserverService({ samplesStorePath: true, uploader });

		expect(service.options.samplesStorePath).toBeUndefined();
		expect(service.options.uploader).toBeUndefined();
		expect(service.listenerCount('client-sink-created')).toBe(0);
	});

	test('disables storage for a blank --samplesStorePath', () => {
		expect(new ObserverService({ samplesStorePath: '' }).options.samplesStorePath).toBeUndefined();
		expect(new ObserverService({ samplesStorePath: '   ' }).options.samplesStorePath).toBeUndefined();
		expect(new ObserverService({ samplesStorePath: 42 }).options.samplesStorePath).toBeUndefined();
	});

	test('keeps a usable path, trimmed', () => {
		expect(new ObserverService({ samplesStorePath: ` ${tmpdir()} ` }).options.samplesStorePath).toBe(tmpdir());
		// client-sink-created is only wired when there is an uploader to send the file.
		expect(new ObserverService({ samplesStorePath: tmpdir() }).listenerCount('client-sink-created')).toBe(0);
	});
});

describe('ObserverService - staged file cleanup', () => {
	test('uploads the sink file under the room/call/client key', async () => {
		const { uploader, calls } = stubUploader(false);
		const { sourcePath } = await runSinkLifecycle(uploader);

		expect(await until(async () => calls.length > 0)).toBe(true);
		expect(calls[0]).toMatchObject({
			key: 'rooms.example.org/room-1/call-1/client-1.jsonl',
			sourcePath,
			contentType: 'application/x-ndjson',
		});
	});

	test('a key taken by an earlier session of the client gets a suffix from the file creation time', async () => {
		const { uploader, calls } = stubUploader(false, false, { 'rooms.example.org/room-1/call-1/client-1.jsonl': 999 });

		await runSinkLifecycle(uploader, undefined, 'call-1__client-1__1700000000000.jsonl');

		expect(await until(async () => calls.length > 0)).toBe(true);
		expect(calls[0].key).toBe('rooms.example.org/room-1/call-1/client-1~1700000000000.jsonl');
	});

	test('a file already stored with the same size is not uploaded again, only cleaned up', async () => {
		const { uploader, calls } = stubUploader(true, false, { 'rooms.example.org/room-1/call-1/client-1.jsonl': 8 });
		const { sourcePath } = await runSinkLifecycle(uploader);

		expect(await until(async () => !(await exists(sourcePath)))).toBe(true);
		expect(calls).toHaveLength(0);
	});

	test('a sink whose file was never created uploads nothing', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'observer-service-'));
		const { uploader, calls } = stubUploader(false);
		const service = new ObserverService({ samplesStorePath: directory, uploader });
		const sink = new JsonlFileSink({ path: join(directory, 'missing', 'client.jsonl') });

		sink.on('error', () => void 0);
		service.emit('client-sink-created', {
			sink,
			observedCall: { callId: 'call-1', appData: { roomId: 'room-1' } },
			observedClient: { clientId: 'client-1', attachments: {} },
		} as never);

		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(calls).toHaveLength(0);
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
	appData: { tenantFqdn: 'rooms.example.org', roomId: 'room-1', clients: {}, routerIds: [] },
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

	test('client-updated lifts tenantFqdn, roomId and displayName off the attachments', () => {
		const svc = service();
		const observedCall = callScope({ appData: { tenantFqdn: undefined, roomId: undefined, clients: { 'client-1': {} }, routerIds: [] } });
		const observedClient = {
			clientId: 'client-1',
			call: observedCall,
			attachments: { tenantFqdn: 'b.example.org', roomId: 'room-9', displayName: 'Ada' },
		};

		svc.emit('client-updated', { observedClient } as never);

		expect(observedCall.appData.tenantFqdn).toBe('b.example.org');
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
	const closeCall = async (sfuId: string, observedCall: CallScope & { summary?: unknown }) => {
		const { uploader, calls } = stubUploader(false);
		const svc = new ObserverService({ samplesStorePath: tmpdir(), uploader, sfuId });

		svc.emit('call-closed', { observedCall } as never);

		expect(await until(async () => calls.length > 0)).toBe(true);

		return calls[0];
	};

	test('call-closed uploads this node\'s summary with the library summary and the call attachments', async () => {
		const upload = await closeCall('sfu-a', {
			...callScope({ appData: { tenantFqdn: 'rooms.example.org', roomId: 'room-1', clients: { 'client-1': { displayName: 'Ada' } }, routerIds: [ 'router-1' ] } }),
			summary: { callId: 'call-1', attachments: {}, scores: { samples: 3 }, issues: [] },
		});

		expect(upload.key).toBe('rooms.example.org/room-1/call-1/call-summary-sfu-a.json');
		expect(upload.contentType).toBe('application/json');
		expect(JSON.parse(String(upload.body))).toEqual({
			callId: 'call-1',
			roomId: 'room-1',
			sfuId: 'sfu-a',
			scores: { samples: 3 },
			issues: [],
			attachments: {
				tenantFqdn: 'rooms.example.org',
				roomId: 'room-1',
				clients: { 'client-1': { displayName: 'Ada' } },
				routerIds: [ 'router-1' ],
				numberOfClientIssues: 2,
				clientsUsedTurn: [ 'client-1' ],
				sfuId: 'sfu-a',
			},
		});
	});

	test('one call on two nodes gives two summaries', async () => {
		const keys = [ (await closeCall('sfu-a', callScope())).key, (await closeCall('sfu-b', callScope())).key ];

		expect(keys).toEqual([ 'rooms.example.org/room-1/call-1/call-summary-sfu-a.json', 'rooms.example.org/room-1/call-1/call-summary-sfu-b.json' ]);
	});

	test('the same room name in two tenants lands in two tenant folders', async () => {
		const other = callScope({ appData: { tenantFqdn: 'b.example.org', roomId: 'room-1', clients: {}, routerIds: [] } });

		expect((await closeCall('sfu-a', callScope())).key).toBe('rooms.example.org/room-1/call-1/call-summary-sfu-a.json');
		expect((await closeCall('sfu-a', other)).key).toBe('b.example.org/room-1/call-1/call-summary-sfu-a.json');
	});

	test('call-closed falls back to unknown-tenant and unknown-room', async () => {
		const upload = await closeCall('sfu-a', callScope({ appData: { tenantFqdn: undefined, roomId: undefined, clients: {}, routerIds: [] } }));

		expect(upload.key).toBe('unknown-tenant/unknown-room/call-1/call-summary-sfu-a.json');
	});

	test('an unsafe tenantFqdn never becomes a key segment', async () => {
		const upload = await closeCall('sfu-a', callScope({ appData: { tenantFqdn: '../other', roomId: 'room-1', clients: {}, routerIds: [] } }));

		expect(upload.key).toBe('unknown-tenant/room-1/call-1/call-summary-sfu-a.json');
	});

	test('the default sfuId differs between services', () => {
		expect(new ObserverService({}).options.sfuId).not.toBe(new ObserverService({}).options.sfuId);
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
		expect(calls[0].key).toBe('rooms.example.org/room-1/call-1/mediasoup-router-router-1.json');
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

		svc.addDataConsumer(dataConsumer as never, 'call-1');

		expect(dataConsumer.on).toHaveBeenCalledWith('message', expect.any(Function));
		expect(dataConsumer.observer.once).toHaveBeenCalledWith('close', expect.any(Function));

		// Fire the registered close handler and confirm it detaches the listener.
		(dataConsumer.observer.once.mock.calls[0][1] as () => void)();
		expect(dataConsumer.off).toHaveBeenCalledWith('message', expect.any(Function));
	});

	test('survives a payload that is not valid JSON', () => {
		const svc = new ObserverService({});
		const dataConsumer = fakeDataConsumer();

		svc.addDataConsumer(dataConsumer as never, 'call-1');

		expect(() => dataConsumer.handlers.message(Buffer.from('not json'))).not.toThrow();
		expect(() => dataConsumer.handlers.message('also not json')).not.toThrow();
		expect(() => dataConsumer.handlers.message('null')).not.toThrow();
		expect(() => dataConsumer.handlers.message('42')).not.toThrow();
		svc.close();
	});

	test('accepts samples for the call of its router and drops samples naming any other call', () => {
		const svc = new ObserverService({});
		const dataConsumer = fakeDataConsumer();
		const message = (callId: unknown) => JSON.stringify({ callId, clientId: 'client-1', timestamp: Date.now(), peerConnections: [] });

		svc.addDataConsumer(dataConsumer as never, 'call-1');

		dataConsumer.handlers.message(message('call-2'));
		dataConsumer.handlers.message(message(undefined));
		expect(svc.observedCalls.size).toBe(0);
		expect(svc.rejectedSamples).toBe(2);

		dataConsumer.handlers.message(Buffer.from(message('call-1')));
		expect([ ...svc.observedCalls.keys() ]).toEqual([ 'call-1' ]);
		expect(svc.rejectedSamples).toBe(2);
		svc.close();
	});

	test('files a call where the room server says, whatever the sample claims', () => {
		const svc = new ObserverService({});
		const accept = jest.spyOn(svc, 'accept');
		const dataConsumer = fakeDataConsumer();
		const message = JSON.stringify({
			callId: 'call-1',
			clientId: 'client-1',
			timestamp: Date.now(),
			peerConnections: [],
			attachments: { tenantFqdn: 'other-tenant.example', roomId: '../elsewhere', displayName: 'J••• D••' },
		});

		svc.addDataConsumer(dataConsumer as never, 'call-1', { tenantFqdn: 'meet.example.org', roomId: 'team-sync' });
		dataConsumer.handlers.message(message);

		expect(accept.mock.calls[0][0].attachments).toEqual({
			tenantFqdn: 'meet.example.org',
			roomId: 'team-sync',
			displayName: 'J••• D••',
		});
		svc.close();
	});

	test('keeps nothing of attachments that are not an object', () => {
		const svc = new ObserverService({});
		const accept = jest.spyOn(svc, 'accept');
		const dataConsumer = fakeDataConsumer();
		const message = (attachments: unknown) => JSON.stringify({ callId: 'call-1', clientId: 'client-1', timestamp: Date.now(), peerConnections: [], attachments });

		svc.addDataConsumer(dataConsumer as never, 'call-1', { tenantFqdn: 'meet.example.org', roomId: 'team-sync' });
		dataConsumer.handlers.message(message('abc'));
		dataConsumer.handlers.message(message([ 'a', 'b' ]));

		for (const [ sample ] of accept.mock.calls)
			expect(sample.attachments).toEqual({ tenantFqdn: 'meet.example.org', roomId: 'team-sync' });

		expect(accept).toHaveBeenCalledTimes(2);
		svc.close();
	});

	test('files a call under its id when the room server names no room', () => {
		const svc = new ObserverService({});
		const accept = jest.spyOn(svc, 'accept');
		const dataConsumer = fakeDataConsumer();
		const message = JSON.stringify({
			callId: 'call-1',
			clientId: 'client-1',
			timestamp: Date.now(),
			peerConnections: [],
			attachments: { tenantFqdn: 'claimed.example', roomId: 'claimed-room' },
		});

		svc.addDataConsumer(dataConsumer as never, 'call-1');
		dataConsumer.handlers.message(message);

		expect(accept.mock.calls[0][0].attachments).toEqual({ tenantFqdn: undefined, roomId: 'call-1' });
		svc.close();
	});
});

describe('ObserverService - sample admission', () => {
	const sample = (callId: unknown, clientId: unknown) => ({ callId, clientId, timestamp: Date.now(), peerConnections: [] });

	test('accepts a sample whose ids are plain tokens', () => {
		const svc = new ObserverService({});

		svc.accept(sample('call-1', 'client-1') as never);

		expect(svc.observedCalls.size).toBe(1);
		expect(svc.rejectedSamples).toBe(0);
		svc.close();
	});

	test.each([
		[ '/../escaped', 'client-1' ],
		[ 'call-1', '/../../escaped' ],
		[ '..', 'client-1' ],
		[ 'call 1', 'client-1' ],
		[ 42, 'client-1' ],
		[ 'call-1', undefined ],
	])('drops a sample with callId %p and clientId %p before the observer sees it', (callId, clientId) => {
		const svc = new ObserverService({});

		svc.accept(sample(callId, clientId) as never);

		expect(svc.observedCalls.size).toBe(0);
		expect(svc.rejectedSamples).toBe(1);
		svc.close();
	});

	test('a crafted callId no longer creates a file outside the store', async () => {
		const parent = await mkdtemp(join(tmpdir(), 'observer-service-'));
		const directory = join(parent, 'store');

		await mkdir(directory);

		const svc = new ObserverService({ samplesStorePath: directory });

		svc.accept(sample('/../escaped', 'c') as never);
		svc.accept(sample('call-1', 'c') as never);

		expect(await until(async () => (await readdir(directory)).some((name) => name.startsWith('call-1__c__')))).toBe(true);
		expect((await readdir(parent)).filter((name) => name !== 'store')).toEqual([]);
		svc.close();
	});

	test('collectsSamples follows the store path', () => {
		expect(new ObserverService({ samplesStorePath: tmpdir() }).collectsSamples).toBe(true);
		expect(new ObserverService({}).collectsSamples).toBe(false);
	});
});

describe('ObserverService - prepareStore', () => {
	test('is a no-op without a store path', async () => {
		await expect(new ObserverService({}).prepareStore()).resolves.toBeUndefined();
	});

	test('creates a missing store directory', async () => {
		const directory = join(await mkdtemp(join(tmpdir(), 'observer-service-')), 'nested', 'store');

		await new ObserverService({ samplesStorePath: directory }).prepareStore();

		expect(await exists(directory)).toBe(true);
	});

	test('uploads leftover files, named with or without a creation time, under the room read from their first sample', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'observer-service-'));

		await writeFile(join(directory, 'call-1__client-1__1700000000000.jsonl'), `${JSON.stringify({ attachments: { tenantFqdn: 'rooms.example.org', roomId: 'room-1' } })}\n`);
		await writeFile(join(directory, 'call-2__client-2.jsonl'), `${JSON.stringify({ attachments: { tenantFqdn: 'rooms.example.org', roomId: 'room-2' } })}\n`);

		const { uploader, calls } = stubUploader(true);

		await new ObserverService({ samplesStorePath: directory, uploader }).prepareStore();

		expect(calls.map((call) => call.key).sort()).toEqual([ 'rooms.example.org/room-1/call-1/client-1.jsonl', 'rooms.example.org/room-2/call-2/client-2.jsonl' ]);
	});

	test('uploads leftover files under the room read from their first sample, then deletes them', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'observer-service-'));
		const staged = join(directory, 'call-1__client-1.jsonl');
		const firstSample = JSON.stringify({ callId: 'call-1', clientId: 'client-1', attachments: { tenantFqdn: 'rooms.example.org', roomId: 'room-9' } });

		await writeFile(staged, `${firstSample}\n{"n":2}\n`);
		await writeFile(join(directory, 'notes.txt'), 'keep me');

		const { uploader, calls } = stubUploader(true);

		await new ObserverService({ samplesStorePath: directory, uploader }).prepareStore();

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ key: 'rooms.example.org/room-9/call-1/client-1.jsonl', sourcePath: staged, contentType: 'application/x-ndjson' });
		expect(await exists(staged)).toBe(false);
		expect(await exists(join(directory, 'notes.txt'))).toBe(true);
	});

	test('falls back to unknown-tenant and unknown-room without a readable first line, and keeps a file whose upload failed', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'observer-service-'));
		const staged = join(directory, 'call-2__client-2.jsonl');

		await writeFile(staged, 'not json\n');

		const { uploader, calls } = stubUploader(true, true);

		await new ObserverService({ samplesStorePath: directory, uploader }).prepareStore();

		expect(calls[0]).toMatchObject({ key: 'unknown-tenant/unknown-room/call-2/client-2.jsonl' });
		expect(await exists(staged)).toBe(true);
	});

	test('leaves files alone without an uploader', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'observer-service-'));
		const staged = join(directory, 'call-3__client-3.jsonl');

		await writeFile(staged, '{}\n');
		await new ObserverService({ samplesStorePath: directory }).prepareStore();

		expect(await exists(staged)).toBe(true);
	});
});

describe('ObserverService - unconfigured node', () => {
	test('touches nothing in mediasoup and keeps no listeners of its own', () => {
		const before = mediasoup.observer.listenerCount('newworker');
		const svc = new ObserverService({});

		expect(mediasoup.observer.listenerCount('newworker')).toBe(before);
		for (const event of [ 'peer-connection-added', 'mediasoup-router-added', 'mediasoup-router-matched-with-peer-connection', 'client-sink-created', 'call-closed' ] as const) {
			expect(svc.listenerCount(event)).toBe(0);
		}
		expect(svc.collectsSamples).toBe(false);

		svc.close();
		expect(mediasoup.observer.listenerCount('newworker')).toBe(before);
	});

	test('hooks mediasoup only once a store is configured, and lets go on close', () => {
		const before = mediasoup.observer.listenerCount('newworker');
		const svc = new ObserverService({ samplesStorePath: tmpdir() });

		expect(mediasoup.observer.listenerCount('newworker')).toBe(before + 1);
		svc.close();
		expect(mediasoup.observer.listenerCount('newworker')).toBe(before);
	});
});
