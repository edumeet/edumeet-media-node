// Mocks
import * as mediasoup from 'mediasoup';
jest.mock('mediasoup');
import { Worker } from 'mediasoup/node/lib/Worker';
jest.mock('mediasoup/node/lib/Worker');
jest.mock('@observertc/sfu-monitor-js');

import 'jest';
import MediaService, { MediaServiceOptions, WorkerData } from '../../src/MediaService';
import * as observeRtcMock from '@observertc/sfu-monitor-js';
import WorkerMock from '../../__mocks__/WorkerMock';
import EventEmitter from 'events';
import { EnhancedEventEmitter } from 'mediasoup/node/lib/EnhancedEventEmitter';
import { Transport } from 'mediasoup/node/lib/Transport';
import { Consumer } from 'mediasoup/node/lib/Consumer';

const emptyMediaServiceOptions = {} as unknown as MediaServiceOptions;
const optionsWithWorkers = {
	rtcMinPort: 1,
	rtcMaxPort: 2,
	numberOfWorkers: 1 
} as unknown as MediaServiceOptions;
const createMonitorSpy = jest.spyOn(observeRtcMock, 'createMediasoupMonitor').mockImplementation((config?: observeRtcMock.MediasoupMonitorConfig) => {
	if (config?.mediasoupCollectors?.pollConsumerStats) {
		return config.mediasoupCollectors.pollConsumerStats('a') as unknown as observeRtcMock.MediasoupMonitor;
	}
	
	return 'no pollstats' as unknown as observeRtcMock.MediasoupMonitor;	
});

test('Constructor - should not throw', () => {
	expect(() => new MediaService(emptyMediaServiceOptions)).not.toThrow();
});

test('useObserveRTC - should create MediasoupMonitor, pollstats should be false', async () => {
	const randomSpy = jest.spyOn(Math, 'random');
	const useObserveRTCOptions = {
		useObserveRTC: true,
		pollStatsProbability: 0.0
	} as unknown as MediaServiceOptions;

	const sut = new MediaService(useObserveRTCOptions);
	const pollStats: boolean = sut.monitor as unknown as boolean;

	expect(createMonitorSpy).toHaveBeenCalledTimes(1);
	expect(pollStats).toBe(false);
	expect(randomSpy).not.toHaveBeenCalled();
	createMonitorSpy.mockClear();
});

test('useObserveRTC - should create MediasoupMonitor, pollstats should be true', async () => {
	const randomSpy = jest.spyOn(Math, 'random');
	const useObserveRTCOptions = {
		useObserveRTC: true,
		pollStatsProbability: 1.1
	} as unknown as MediaServiceOptions;

	const sut = new MediaService(useObserveRTCOptions);
	const pollStats: boolean = sut.monitor as unknown as boolean;

	expect(createMonitorSpy).toHaveBeenCalledTimes(1);
	expect(pollStats).toBe(true);
	expect(randomSpy).not.toHaveBeenCalled();
	createMonitorSpy.mockClear();
});

test('useObserveRTC - should create MediasoupMonitor, pollstats should be random', async () => {
	const randomSpy = jest.spyOn(Math, 'random');
	const useObserveRTCOptions = {
		useObserveRTC: true,
		pollStatsProbability: 0.5
	} as unknown as MediaServiceOptions;

	const sut = new MediaService(useObserveRTCOptions);

	expect(createMonitorSpy).toHaveBeenCalledTimes(1);
	expect(sut.monitor).not.toBe(undefined);
	expect(randomSpy).toHaveBeenCalledTimes(1);
	createMonitorSpy.mockClear();
});

test('Close() - Should close', () => {
	const sut = new MediaService(emptyMediaServiceOptions);

	sut.close();
	expect(sut.closed).toBeTruthy();
	expect(sut['workers'].length).toBe(0);
});

test('getRouter() - should return router', async () => {
	const spyObserver = new EventEmitter() as unknown as EnhancedEventEmitter;
	const sut = new MediaService(emptyMediaServiceOptions);
	const mockWorker1 = new WorkerMock(spyObserver, 1, 1) as unknown as Worker;

	sut.workers.add(mockWorker1);

	const router = await sut.getRouter('roomId');

	expect(router.id).toBe('roomId');
});

test('getRouter() - should close router', async () => {
	const spyObserver = new EventEmitter() as unknown as EnhancedEventEmitter;
	const sut = new MediaService(emptyMediaServiceOptions);
	const mockWorker1 = new WorkerMock(spyObserver, 1, 1) as unknown as Worker;

	sut.workers.add(mockWorker1);

	const router = await sut.getRouter('roomId');
	let appData: WorkerData = mockWorker1.appData as unknown as WorkerData;

	expect(appData.routersByRoomId.get('roomId')).resolves.toEqual(router);

	await spyObserver.emit('close');

	appData = mockWorker1.appData as unknown as WorkerData;
	expect(appData.routersByRoomId.get('roomId')).toBeUndefined();
});

test('getRouter() - should use worker with least load on first participant', async () => {
	const spyObserver = new EventEmitter() as unknown as EnhancedEventEmitter;
	const sut = new MediaService(emptyMediaServiceOptions);
	const mockWorker1 = new WorkerMock(spyObserver, 1, 10) as unknown as Worker;
	const mockWorker2 = new WorkerMock(spyObserver, 2, 20) as unknown as Worker;

	sut.workers.add(mockWorker1);
	sut.workers.add(mockWorker2);
	const router1 = await sut.getRouter('id');
	const router2 = await sut.getRouter('id');

	expect(router1.appData.workerPid).toBe(1);
	expect(router2.appData.workerPid).toBe(1);
});

test('getRouter() - should not choose less load worker when router exists', async () => {
	const spyObserver = new EventEmitter() as unknown as EnhancedEventEmitter;
	const sut = new MediaService(emptyMediaServiceOptions);
	const mockWorker1 = new WorkerMock(spyObserver, 1, 20) as unknown as Worker;
	const mockWorker2 = new WorkerMock(spyObserver, 2, 30) as unknown as Worker;
	const mockWorker3 = new WorkerMock(spyObserver, 3, 10) as unknown as Worker;

	sut.workers.add(mockWorker1);
	sut.workers.add(mockWorker2);
	
	const router1 = await sut.getRouter('id');

	expect(router1.appData.workerPid).toBe(1);

	sut.workers.add(mockWorker3);
	const router2 = await sut.getRouter('id');
	
	expect(router2.appData.workerPid).toBe(1);
});

test('getRouter() - should choose other worker when load > 500', async () => {
	const spyObserver = new EventEmitter() as unknown as EnhancedEventEmitter;
	const sut = new MediaService(emptyMediaServiceOptions);
	const mockWorker1 = new WorkerMock(spyObserver, 1, 500) as unknown as Worker;
	const mockWorker2 = new WorkerMock(spyObserver, 2, 10) as unknown as Worker;

	sut.workers.add(mockWorker1);
	const router1 = await sut.getRouter('id');

	sut.workers.add(mockWorker2);
	const router2 = await sut.getRouter('id');

	expect(router1.appData.workerPid).toBe(1);
	expect(router2.appData.workerPid).toBe(2);

});

test('getRouter() - should use oversaturated worker if it is the least loaded in general', async () => {
	const spyObserver = new EventEmitter() as unknown as EnhancedEventEmitter;
	const sut = new MediaService(emptyMediaServiceOptions);
	const mockWorker1 = new WorkerMock(spyObserver, 1, 500) as unknown as Worker;
	const mockWorker2 = new WorkerMock(spyObserver, 2, 504) as unknown as Worker;

	sut.workers.add(mockWorker1);
	sut.workers.add(mockWorker2);
	
	const router1 = await sut.getRouter('id');
	const router2 = await sut.getRouter('id');

	expect(router1.appData.workerPid).toBe(1);
	expect(router2.appData.workerPid).toBe(1);
});

test('getMetrics() - should return consumers and routers', async () => {
	const spyObserver = new EventEmitter() as unknown as EnhancedEventEmitter;
	const sut = new MediaService(emptyMediaServiceOptions);
	const mockWorker1 = new WorkerMock(spyObserver, 1, 200) as unknown as Worker;

	sut.workers.add(mockWorker1);
	await sut.getRouter('id1');

	let metrics = sut.getMetrics();

	expect(metrics[mockWorker1.pid].routers).toBe(1);
	await sut.getRouter('id2');

	metrics = sut.getMetrics();

	expect(metrics[mockWorker1.pid].consumers).toBe(200);
	expect(metrics[mockWorker1.pid].routers).toBe(2);
});

test('getMetrics() - should give correct consumer count on add/remove consumer', async () => {
	const spyObserver = new EventEmitter() as unknown as EnhancedEventEmitter;
	const mockWorker = new WorkerMock(spyObserver, 1) as unknown as Worker;

	jest.spyOn(mediasoup, 'createWorker').mockImplementation(async () => {
		return mockWorker;
	});
	const sut = new MediaService(emptyMediaServiceOptions);

	await sut.startWorkers(optionsWithWorkers);
	let metrics = sut.getMetrics();

	expect(metrics['1'].consumers).toBe(0);

	const router1 = await sut.getRouter('id1');

	const spyTransport = new EventEmitter();
	const spyConsumer = new EventEmitter();
	const fakeTransport = { observer: spyTransport } as unknown as Transport;
	const fakeConsumer = { observer: spyConsumer, closed: false, id: 'id' } as unknown as Consumer;

	await spyObserver.emit('newrouter', router1);
	await spyObserver.emit('newtransport', fakeTransport);
	await spyTransport.emit('newconsumer', fakeConsumer);

	metrics = sut.getMetrics();
	expect(metrics['1'].consumers).toBe(1);

	spyConsumer.emit('close');
	
	metrics = sut.getMetrics();
	expect(metrics['1'].consumers).toBe(0);
});