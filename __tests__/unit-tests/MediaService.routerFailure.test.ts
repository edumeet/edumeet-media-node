// @ts-nocheck

jest.mock('mediasoup');

type Worker = any;

import 'jest';
import EventEmitter from 'events';
import { EnhancedEventEmitter } from 'mediasoup/node/lib/EnhancedEventEmitter';
import MediaService, { MediaServiceOptions, WorkerData } from '../../src/MediaService';
import WorkerMock from '../../__mocks__/WorkerMock';

const failingWorker = (pid: number, failures: number): Worker => {
	const worker = new WorkerMock(new EventEmitter() as unknown as EnhancedEventEmitter, pid, 1) as unknown as Worker;
	const createRouter = jest.fn(worker.createRouter);

	for (let i = 0; i < failures; i++)
		createRouter.mockRejectedValueOnce(new Error('router creation failed'));

	worker.createRouter = createRouter;

	return worker;
};

const createServiceWithFailingWorker = (failures: number) => {
	const sut = new MediaService({} as unknown as MediaServiceOptions);
	const worker = failingWorker(1, failures);

	sut.workers.add(worker);

	return { sut, worker, createRouter: worker.createRouter };
};

test('getRouter() - a failed router creation is not cached for the room', async () => {
	const { sut, worker } = createServiceWithFailingWorker(1);

	await expect(sut.getRouter('roomId')).rejects.toThrow('router creation failed');
	expect((worker.appData as WorkerData).routersByRoomId.has('roomId')).toBe(false);

	const router = await sut.getRouter('roomId');

	expect(router.id).toBe('roomId');
	expect((worker.appData as WorkerData).routersByRoomId.has('roomId')).toBe(true);
});

test('getRouter() - callers waiting on the same failed creation all fail, and the next call creates a router', async () => {
	const { sut, createRouter } = createServiceWithFailingWorker(1);

	const results = await Promise.allSettled([ sut.getRouter('roomId'), sut.getRouter('roomId') ]);

	expect(results.map((r) => r.status)).toEqual([ 'rejected', 'rejected' ]);
	expect(createRouter).toHaveBeenCalledTimes(1);

	await expect(sut.getRouter('roomId')).resolves.toMatchObject({ id: 'roomId' });
	expect(createRouter).toHaveBeenCalledTimes(2);
});

test('getRouter() - a failed creation neither affects another room nor sticks to its own room', async () => {
	const { sut } = createServiceWithFailingWorker(1);

	await expect(sut.getRouter('failingRoom')).rejects.toThrow('router creation failed');
	await expect(sut.getRouter('otherRoom')).resolves.toMatchObject({ id: 'otherRoom' });
	await expect(sut.getRouter('failingRoom')).resolves.toMatchObject({ id: 'failingRoom' });
});

test('getRouter() - a failed cascade to a second worker does not break the room on the first worker', async () => {
	const sut = new MediaService({ cpuPercentCascadingLimit: 66 } as unknown as MediaServiceOptions);
	const busyWorker = failingWorker(1, 0);
	const idleWorker = failingWorker(2, 1);

	sut.workers.add(busyWorker);
	sut.workers.add(idleWorker);
	(busyWorker.appData as WorkerData).cpuUsage = 10;
	(idleWorker.appData as WorkerData).cpuUsage = 20;

	await expect(sut.getRouter('roomId')).resolves.toMatchObject({ appData: { workerPid: 1 } });

	// The room's worker is now saturated, so the next peer cascades to the idle worker, whose creation fails.
	(busyWorker.appData as WorkerData).cpuUsage = 90;
	(idleWorker.appData as WorkerData).cpuUsage = 10;

	await expect(sut.getRouter('roomId')).rejects.toThrow('router creation failed');

	// Later peers must still get a router; before the fix every call for this room failed here.
	await expect(sut.getRouter('roomId')).resolves.toMatchObject({ appData: { workerPid: 2 } });
	expect(idleWorker.createRouter).toHaveBeenCalledTimes(2);
});
