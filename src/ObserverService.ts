import { Logger } from 'edumeet-common';
import { mkdir, open, readdir, stat, unlink } from 'fs/promises';
import { hostname } from 'os';
import { basename, join } from 'path';
import { format } from 'util';
import { DataConsumer } from 'mediasoup/types';
import * as mediasoup from 'mediasoup';
import {
	AcceptContext,
	ClientSample,
	createDefaultMediasoupRemoteTrackResolverFactory,
	createJsonlFileSinkFactory,
	JsonlFileSink,
	ObservedCall,
	Observer,
	ObserverEvents,
	setObserverLogger,
} from '@observertc/observer-js';
import { Uploader } from './uploader/Uploader';
import { randomUUID } from 'crypto';

const logger = new Logger('ObserverService');

/**
 * `tenantFqdn` and `roomId` come from the room server, which has the first from
 * the URL a client connected with and the second from a name people choose, so
 * they can never be trusted as key segments. `encodeURIComponent` does not escape `..`,
 * so an unchecked value would survive into `HttpUploader.buildUrl()` and let URL
 * normalisation move the POST outside the configured base path. Anything that
 * is not a plain, bounded token is replaced by the fallback.
 */
const SAFE_KEY_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;

const isSafeKeySegment = (value: unknown): value is string =>
	typeof value === 'string' && value !== '.' && value !== '..' && SAFE_KEY_SEGMENT.test(value);

/** A client-supplied value as it may appear in a log line: bounded, so one sample cannot bloat the log. */
const forLog = (value: unknown): string => {
	const text = String(value);

	return text.length > 128 ? `${text.slice(0, 128)}...` : text;
};

const safeKeySegment = (value: unknown, fallback: string): string => {
	if (!isSafeKeySegment(value)) {
		if (value !== undefined) logger.warn('safeKeySegment() rejected unsafe segment [value: %s]', forLog(value));

		return fallback;
	}

	return value;
};

type RoomLabels = { tenantFqdn?: unknown, roomId?: unknown };

/**
 * `<tenantFqdn>/<roomId>`, the start of every key. `tenantFqdn` is the host name
 * the client joined on, the same value the room server resolves the tenant from,
 * so each tenant's data sits under a folder of its own.
 */
const roomPrefix = ({ tenantFqdn, roomId }: RoomLabels): string =>
	`${safeKeySegment(tenantFqdn, 'unknown-tenant')}/${safeKeySegment(roomId, 'unknown-room')}`;

/**
 * A staged per-client file: `<callId>__<clientId>__<created ms>.jsonl`, the
 * creation time absent in files from before it was added. Neither id can contain
 * a separator once `accept()` has vetted it, so the first `__` is the boundary.
 * The creation time keeps a rejoining client off the file of its previous
 * session, which may still be uploading.
 */
const STAGED_FILE = /^([A-Za-z0-9._-]+?)__([A-Za-z0-9._-]+?)(?:__(\d+))?\.jsonl$/;

/** The library logs as `(moduleName, message, ...details)`; pino would keep only the first string. */
const forward = (level: 'debug' | 'warn' | 'error') =>
	(moduleName: unknown, ...args: unknown[]) => logger[level](`${String(moduleName)}: ${format(...args)}`);

setObserverLogger({
	debug: () => void 0,
	info: forward('debug'),
	warn: forward('warn'),
	error: forward('error'),
	trace: () => void 0,
});

export type ObservedCallAppData = {
	tenantFqdn: string | undefined;
	roomId: string | undefined;
	clients: Record<string, {
		displayName?: string,
	}>;
	routerIds: string[];
}

export type ObserverServiceOptions = {

	/**
	 * The ID of the SFU this service is running in. This is used to tag samples with the SFU they came from, so that the observer can distinguish between samples
	 * from different SFUs when multiple nodes are reporting to the same observer.
	 * Each node writes its own call summary under it, so it must differ between nodes.
	 */
	sfuId: string;

	/**
	 * Directory the per-client JSONL files are written to.
	 *
	 * Required for uploading: the observer only creates a file sink when it has
	 * somewhere to write, and the uploader sends that file. Without it there is
	 * nothing worth uploading, so `uploader` is ignored.
	 */
	samplesStorePath?: string;

	uploader?: Uploader;
}

/**
 * What the constructor accepts, as opposed to what the service settles on.
 *
 * `samplesStorePath` is widened here because it arrives straight from minimist,
 * which yields `true` for a valueless `--samplesStorePath` rather than a string.
 * Passing that on would reach `createJsonlFileSinkFactory({ directory })` and
 * take the node down at startup, so the constructor normalises it first;
 * `service.options` only ever exposes the narrowed form.
 */
export type ObserverServiceInput = Omit<ObserverServiceOptions, 'samplesStorePath' | 'sfuId'> & {
	samplesStorePath?: unknown;
	sfuId?: string;
}

export type ObserverServiceEvents = Omit<ObserverEvents, 'observer-closed' | 'sample-rejected'>;

/** The single argument the observer hands a listener for event `K`. */
type EventScope<K extends keyof ObserverEvents> = ObserverEvents[K][0];

export class ObserverService extends Observer {
	/**
	 * Narrow the raw `--samplesStorePath` value to a usable directory, or to
	 * `undefined` with a warning. Sample storage is a diagnostic, so a malformed
	 * flag disables it rather than stopping the node from starting.
	 */
	private static normalizeStorePath(value: unknown): string | undefined {
		if (value === undefined) return undefined;

		const directory = typeof value === 'string' ? value.trim() : '';

		if (!directory) {
			logger.warn(
				'normalizeStorePath() --samplesStorePath needs a directory, sample storage disabled [value: %s]',
				String(value)
			);

			return undefined;
		}

		return directory;
	}

	/**
	 * The options the service actually runs on. This is a private copy: the
	 * caller's object is never written to, so it stays safe to reuse.
	 */
	private static resolveOptions(input: ObserverServiceInput): ObserverServiceOptions {
		const samplesStorePath = ObserverService.normalizeStorePath(input.samplesStorePath);
		const host = hostname()
			.replace(/[^A-Za-z0-9.-]+/g, '-')
			.slice(0, 40);
		const sfuId = input.sfuId ?? `${host ? `${host}-` : ''}${randomUUID().substring(0, 8)}`;
		const options: ObserverServiceOptions = { ...input, samplesStorePath, sfuId };

		if (options.uploader && !samplesStorePath) {
			logger.warn('resolveOptions() ignoring --samplesUploadUri, nothing to upload without --samplesStorePath');

			options.uploader = undefined;
		}

		return options;
	}

	private static buildObserverConfig(): ConstructorParameters<typeof Observer>[0] {
		return {
			closeCallIfEmptyForMs: 5 * 60 * 1000, // 5 minutes
			closeClientIfIdleForMs: 1 * 60 * 1000, // 1 minute,
			createRemoteTrackResolver: createDefaultMediasoupRemoteTrackResolverFactory(),
			autoUpdateOnCallUpdate: true,
			callSummary: {
				include: [ 'clients', 'issues', 'scores' ],
			}
		};
	}

	public readonly options: ObserverServiceOptions;

	public constructor(input: ObserverServiceInput) {
		const options = ObserverService.resolveOptions(input);

		super(ObserverService.buildObserverConfig());

		this.options = options;

		if (options.samplesStorePath) {
			this.config.createClientSink = createJsonlFileSinkFactory({
				directory: options.samplesStorePath,
				getFileName: ({ callId, clientId }) => `${callId}__${clientId}__${Date.now()}.jsonl`,
			});
		}

		logger.debug('constructor()');

		if (options.samplesStorePath && options.uploader) {
			logger.info(
				'observertc sample collection enabled [storePath: %s, deleteAfterUpload: %s]',
				options.samplesStorePath,
				String(options.uploader.deleteAfterUpload)
			);
		} else if (options.samplesStorePath) {
			logger.info(
				'observertc sample collection enabled, uploads disabled [storePath: %s]',
				options.samplesStorePath
			);
		}

		this.setupObserverEvents();
		this.config.createCallAppData = this.createObservedCallAppData.bind(this);
	}

	private get sfuId(): string {
		return this.options.sfuId;
	}

	/** Whether samples are wanted at all; without a store there is nowhere for them to go. */
	public get collectsSamples(): boolean {
		return Boolean(this.options.samplesStorePath);
	}

	/**
	 * `callId` and `clientId` come from the client and end up in file names and
	 * upload keys, and the observer only checks that they are non-empty: a callId
	 * of `/../x` writes outside the store directory. Anything that is not a plain
	 * token is dropped before the observer sees it. Every id edumeet issues is a
	 * UUID, so legitimate samples always pass.
	 */
	public override accept(sample: ClientSample, context?: AcceptContext): void {
		if (!isSafeKeySegment(sample.callId) || !isSafeKeySegment(sample.clientId)) {
			this.rejectedSamples++;
			logger.debug('accept() rejected sample with unsafe ids [callId: %s, clientId: %s]', forLog(sample.callId), forLog(sample.clientId));

			return;
		}

		super.accept(sample, context);
	}

	public rejectedSamples = 0;

	/**
	 * Get the store ready for this process and settle what the previous one left
	 * behind. Files still in the store were written by clients of a process that
	 * no longer exists (a crash before their sinks closed, an upload that failed,
	 * or a shutdown that exited before its uploads finished), so they are complete
	 * and safe to send. The tenant and room are not in the file name; they are read
	 * from the first sample in the file, the same attachments the live path uses.
	 */
	public async prepareStore(): Promise<void> {
		const { samplesStorePath, uploader } = this.options;

		if (!samplesStorePath) return;

		await mkdir(samplesStorePath, { recursive: true });

		if (!uploader) return;

		for (const name of await readdir(samplesStorePath)) {
			const match = STAGED_FILE.exec(name);

			if (!match) continue;

			const [ , callId, clientId ] = match;
			const sourcePath = join(samplesStorePath, name);

			await this.uploadClientFile(uploader, {
				...await this.readStagedLabels(sourcePath),
				callId,
				clientId,
				sourcePath,
				leftover: true,
			});
		}
	}

	private async readStagedLabels(path: string): Promise<RoomLabels> {
		const handle = await open(path, 'r');

		try {
			const buffer = Buffer.alloc(64 * 1024);
			const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
			const firstLine = buffer.toString('utf8', 0, bytesRead).split('\n', 1)[0];

			const attachments = (JSON.parse(firstLine) as ClientSample).attachments;

			return { tenantFqdn: attachments?.['tenantFqdn'], roomId: attachments?.['roomId'] };
		} catch {
			return {};
		} finally {
			await handle.close();
		}
	}

	/**
	 * Register a mediasoup DataProducer that carries observer samples.
	 * Called from producerMiddleware when label === 'observertc-samples'.
	 *
	 * `callId` is the `roomId` of the router the channel was produced on. That is
	 * the room session the room server put the sender in, and the only call id an
	 * honest client reports, so a sample naming any other call is dropped: a
	 * client can write into its own call, not invent one or reach another.
	 *
	 * `labels` is where the room server wants the call filed. They replace
	 * whatever the sample says about tenant and room, so a client cannot choose
	 * its folder, and everything downstream keeps reading the attachments. A room
	 * server that names no room gets the call filed under its id.
	 */
	public addDataConsumer(dataConsumer: DataConsumer, callId: string, labels: RoomLabels = {}): void {
		logger.debug('addDataConsumer() [id: %s]', dataConsumer.id);

		const onMessage = (payload: Buffer | string) => {
			try {
				const text = Buffer.isBuffer(payload)
					? payload.toString('utf8')
					: String(payload);

				const sample = JSON.parse(text) as ClientSample | null;

				if (sample?.callId !== callId) {
					this.rejectedSamples++;
					logger.debug('addDataConsumer() rejected sample for another call [dataConsumerId: %s, callId: %s]', dataConsumer.id, forLog(sample?.callId));

					return;
				}

				const claimed = sample.attachments;

				sample.attachments = {
					...(claimed && typeof claimed === 'object' && !Array.isArray(claimed) ? claimed : {}),
					tenantFqdn: labels.tenantFqdn,
					roomId: labels.roomId ?? callId,
				};

				this.accept(sample);
			} catch (error) {
				logger.error(
					{ err: error },
					'addDataConsumer() error accepting sample [dataConsumerId: %s]',
					dataConsumer.id
				);
			}
		};

		dataConsumer.observer.once('close', () => {
			dataConsumer.off('message', onMessage);
		});
		dataConsumer.on('message', onMessage);
	}

	private createObservedCallAppData(): ObservedCallAppData {
		return {
			tenantFqdn: undefined, // populated from client sample attachments via 'client-updated'
			roomId: undefined,
			clients: {},
			routerIds: [],
		};
	}

	/**
	 * Wire up the subscriptions. Each handler is an arrow class property, so it
	 * stays bound when passed by reference here; those run immediately after
	 * `super()`, before this method is called.
	 *
	 * Only the first group is unconditional. The rest exists solely to produce
	 * artifacts for the uploader, and to keep the call appData those artifacts
	 * are built from — `ObservedCallAppData` is read nowhere else. With nowhere to
	 * send anything, none of that work is worth doing, so we do not subscribe at
	 * all rather than subscribe and bail out per event.
	 */
	private setupObserverEvents(): void {
		// A node that collects no samples must run exactly as it did before this
		// service existed: no mediasoup hooks, no per-router bookkeeping. Nothing
		// below can ever match a client without samples anyway.
		if (!this.collectsSamples) return;

		this.on('peer-connection-added', this.handlePeerConnectionAdded);
		this.on('mediasoup-router-added', this.handleMediasoupRouterAdded);
		this.on('mediasoup-router-matched-with-peer-connection', this.handleMediasoupRouterMatched);

		// Not one of our own events: mediasoup's global observer is how we learn
		// about routers, so they can be attached to the calls that use them.
		mediasoup.observer.on('newworker', this.handleNewMediasoupWorker);

		if (this.options.uploader) {
			this.on('client-sink-created', this.handleClientSinkCreated);
			this.on('client-added', this.handleClientAdded);
			this.on('client-updated', this.handleClientUpdated);
			this.on('call-closed', this.handleCallClosed);
			this.on('mediasoup-router-removed', this.handleMediasoupRouterRemoved);
		}
	}

	/**
	 * Upload the client's JSONL file once its sink closes, i.e. once the observed
	 * client has left and nothing more will be written.
	 */
	private handleClientSinkCreated = ({ sink, observedCall, observedClient }: EventScope<'client-sink-created'>): void => {
		const sourcePath = sink instanceof JsonlFileSink ? sink.path : undefined;

		if (!sourcePath) return;

		sink.once('close', async () => {
			const { uploader } = this.options;

			if (!uploader) return logger.info('sample file written [clientId: %s, path: %s]', observedClient.clientId, sourcePath);

			const call = observedCall as ObservedCall<ObservedCallAppData>;
			const sampleAttachments = observedClient.attachments as Record<string, unknown> | undefined;

			await this.uploadClientFile(uploader, {
				tenantFqdn: call.appData?.tenantFqdn ?? sampleAttachments?.['tenantFqdn'],
				roomId: call.appData?.roomId ?? sampleAttachments?.['roomId'],
				callId: call.callId,
				clientId: observedClient.clientId,
				sourcePath,
			});
		});
	};

	/**
	 * One client file to storage, whether its sink has just closed or a previous
	 * process left it behind. The size is logged because a 0-byte file is the
	 * tell-tale of a client that connected but never sent a sample, which
	 * otherwise looks identical to success.
	 */
	private async uploadClientFile(
		uploader: Uploader,
		file: RoomLabels & { callId: string, clientId: string, sourcePath: string, leftover?: boolean },
	): Promise<void> {
		const stats = await stat(file.sourcePath).catch(() => undefined);

		if (!stats) {
			logger.warn('uploadClientFile() no sample file to upload, is the store writable? [path: %s]', file.sourcePath);

			return;
		}

		const prefix = roomPrefix(file);
		let targetKey = `${prefix}/${file.callId}/${file.clientId}.jsonl`;

		try {
			const stored = await uploader.head?.(targetKey);

			if (stored?.size === stats.size) {
				logger.info('sample file already uploaded [key: %s] from %s', targetKey, file.sourcePath);

				if (uploader.deleteAfterUpload) await this.deleteUploadedFile(file.sourcePath, targetKey);

				return;
			}

			// The key is taken by an earlier session of the same client, on this node
			// or another one, so this session goes next to it rather than over it.
			if (stored) {
				const created = STAGED_FILE.exec(basename(file.sourcePath))?.[3] ?? String(Math.round(stats.mtimeMs));

				targetKey = `${prefix}/${file.callId}/${file.clientId}~${created}.jsonl`;
			}

			await uploader.upload({ key: targetKey, sourcePath: file.sourcePath, contentType: 'application/x-ndjson' });

			logger.info(
				'%s uploaded [key: %s, bytes: %d] from %s, deletedAfterUpload: %s',
				file.leftover ? 'leftover sample file' : 'sample file',
				targetKey, stats.size, file.sourcePath, String(uploader.deleteAfterUpload)
			);

			if (uploader.deleteAfterUpload) await this.deleteUploadedFile(file.sourcePath, targetKey);
		} catch (error) {
			logger.error({ err: error }, 'uploadClientFile() upload failed [key: %s]', targetKey);
		}
	}

	private async deleteUploadedFile(path: string, key: string): Promise<void> {
		try {
			await unlink(path);
		} catch (error) {
			logger.warn({ err: error }, 'deleteUploadedFile() delete failed [key: %s, path: %s]', key, path);
		}
	}

	/** Seed the call's appData entry for a client that just joined. */
	private handleClientAdded = (scope: EventScope<'client-added'>): void => {
		const observedCall = scope.observedCall as ObservedCall<ObservedCallAppData>;

		observedCall.appData.clients[scope.observedClient.clientId] = {

		};
	};

	/** Lift tenantFqdn, roomId and displayName out of client sample attachments onto the call. */
	private handleClientUpdated = ({ observedClient }: EventScope<'client-updated'>): void => {
		const observedCall = observedClient.call as ObservedCall<ObservedCallAppData>;

		if (observedCall.appData && !observedCall.appData.tenantFqdn && observedClient.attachments?.tenantFqdn) {
			observedCall.appData.tenantFqdn = observedClient.attachments.tenantFqdn as string;
		}

		if (!observedCall.appData?.roomId && observedClient.attachments?.roomId) {

			observedCall.appData.roomId = observedClient.attachments.roomId as string;

			logger.debug('handleClientUpdated() set roomId [callId: %s, roomId: %s]', observedClient.call.callId, forLog(observedCall.appData.roomId));
		}

		// `client-added` may never have been seen for this client, in which case the
		// entry is absent. Writing through it would throw, and an uncaught throw here
		// takes the whole media node down via the process-level handler in server.ts.
		const clientEntry = observedCall.appData?.clients?.[observedClient.clientId];

		if (clientEntry && observedClient.attachments?.displayName) {
			clientEntry.displayName = observedClient.attachments.displayName as string;
		}
	};

	private handlePeerConnectionAdded = ({ observedClient, observedCall, observedPeerConnection }: EventScope<'peer-connection-added'>): void => {
		logger.debug('handlePeerConnectionAdded() [callId: %s, clientId: %s, peerConnectionId: %s]', observedCall.callId, observedClient.clientId, observedPeerConnection.peerConnectionId);
	};

	private handleCallClosed = async ({ observedCall: rawCall }: EventScope<'call-closed'>): Promise<void> => {
		const observedCall = rawCall as ObservedCall<ObservedCallAppData>;

		logger.debug('handleCallClosed() [callId: %s, appData: %o]', observedCall.callId, observedCall.appData);

		const { uploader } = this.options;

		if (!uploader || !observedCall.appData) return;

		try {
			const { appData } = observedCall;

			// Every node that carried part of the call writes its own summary; the
			// dashboard merges the `call-summary-<sfuId>.json` files of a call.
			const targetKey = `${roomPrefix(appData)}/${observedCall.callId}/call-summary-${this.sfuId}.json`;
			const summary = observedCall.summary ?? { callId: observedCall.callId, attachments: {} };

			const body = JSON.stringify({
				...summary,
				roomId: appData.roomId,
				sfuId: this.sfuId,
				attachments: {
					...summary.attachments,
					tenantFqdn: appData.tenantFqdn,
					roomId: appData.roomId,
					clients: appData.clients,
					routerIds: appData.routerIds,
					numberOfClientIssues: observedCall.numberOfIssues,
					clientsUsedTurn: [ ...observedCall.clientsUsedTurn ],
					sfuId: this.sfuId,
				},
			});

			await uploader.upload({
				key: targetKey,
				body,
				contentType: 'application/json',
			});

			logger.info('sample file uploaded [key: %s] from call %s', targetKey, observedCall.callId);

		} catch (error) {
			logger.error({ err: error }, 'handleCallClosed() upload failed [callId: %s]', observedCall.callId);
		}
	};

	/** Observe every router each mediasoup worker creates. */
	private handleNewMediasoupWorker = (worker: mediasoup.types.Worker): void => {
		const onNewRouter = (router: mediasoup.types.Router) => {
			this.createObservedMediasoupRouter({
				router,
				matchPeerConnectionByWebRtcTransportId: true,
				attachments: {
					sfuId: this.sfuId,
				}
				// enrich: {
				// }
			});
		};

		worker.observer.once('close', () => {
			worker.observer.off('newrouter', onNewRouter);
		});
		worker.observer.on('newrouter', onNewRouter);
	};

	private handleMediasoupRouterAdded = ({ observedMediasoupRouter }: EventScope<'mediasoup-router-added'>): void => {
		logger.debug('handleMediasoupRouterAdded() [routerId: %s, sample: %o]', observedMediasoupRouter.router.id, observedMediasoupRouter.sample);
	};

	/** Remember which call a router belongs to, and tag the client with its id. */
	private handleMediasoupRouterMatched = ({ observedClient, observedCall, observedMediasoupRouter }: EventScope<'mediasoup-router-matched-with-peer-connection'>): void => {
		observedMediasoupRouter.appData = {
			observedCall,
		};

		logger.debug('handleMediasoupRouterMatched() [routerId: %s, callId: %s, clientId: %s]', observedMediasoupRouter.router.id, observedCall.callId, observedClient.clientId);

		observedClient.injectAttachment({
			routerId: observedMediasoupRouter.router.id,
		});

		const callAppData = (observedCall as ObservedCall<ObservedCallAppData>).appData;

		if (callAppData?.routerIds && !callAppData.routerIds.includes(observedMediasoupRouter.router.id)) {
			callAppData.routerIds.push(observedMediasoupRouter.router.id);
		}
	};

	/** Upload the router's own sample once it goes away. */
	private handleMediasoupRouterRemoved = async ({ observedMediasoupRouter }: EventScope<'mediasoup-router-removed'>): Promise<void> => {
		logger.debug('handleMediasoupRouterRemoved() [routerId: %s, sample: %o, appData: %o]', observedMediasoupRouter.router.id, observedMediasoupRouter.sample, observedMediasoupRouter.appData);

		const { uploader } = this.options;

		// The router sample can be sizeable; do not stringify it for nobody.
		if (!uploader || !observedMediasoupRouter.appData?.observedCall) return;

		const observedCall = observedMediasoupRouter.appData.observedCall as ObservedCall<ObservedCallAppData>;

		if (!observedCall.appData.roomId) return;

		try {
			const sample = JSON.stringify(observedMediasoupRouter.sample);
			const targetKey = `${roomPrefix(observedCall.appData)}/${observedCall.callId}/mediasoup-router-${observedMediasoupRouter.router.id}.json`;

			await uploader.upload({
				key: targetKey,
				body: sample,
				contentType: 'application/json',
			});

			logger.info('sample file uploaded [key: %s] for router %s', targetKey, observedMediasoupRouter.router.id);
		} catch (error) {
			logger.error({ err: error }, 'handleMediasoupRouterRemoved() upload failed [routerId: %s]', observedMediasoupRouter.router.id);
		}
	};

	/**
	 * `mediasoup.observer` is a process-level singleton that outlives this
	 * service, so the 'newworker' subscription has to be released explicitly or
	 * it keeps the closed ObserverService reachable.
	 */
	public override close(): void {
		mediasoup.observer.off('newworker', this.handleNewMediasoupWorker);

		this.off('peer-connection-added', this.handlePeerConnectionAdded);
		this.off('mediasoup-router-added', this.handleMediasoupRouterAdded);
		this.off('mediasoup-router-matched-with-peer-connection', this.handleMediasoupRouterMatched);

		if (this.options.uploader) {
			this.off('client-sink-created', this.handleClientSinkCreated);
			this.off('client-added', this.handleClientAdded);
			this.off('client-updated', this.handleClientUpdated);
			this.off('call-closed', this.handleCallClosed);
			this.off('mediasoup-router-removed', this.handleMediasoupRouterRemoved);
		}

		super.close();
	}

}
