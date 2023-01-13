// Mocks
import * as mediasoup from 'mediasoup';
jest.mock('mediasoup');
import { Worker } from 'mediasoup/node/lib/Worker';
jest.mock('mediasoup/node/lib/Worker');

import 'jest';
import MediaService, { MediaServiceOptions } from '../src/MediaService';
import WorkerMock from './__mocks__/WorkerMock';
import EventEmitter from 'events';
import { EnhancedEventEmitter } from 'mediasoup/node/lib/EnhancedEventEmitter';
import TestUtils from './TestUtils';

const emptyMediaServiceOptions = {} as unknown as MediaServiceOptions;
const optionsWithWorkers = {
	rtcMinPort: 1,
	rtcMaxPort: 2,
	numberOfWorkers: 1 
} as unknown as MediaServiceOptions;

test('Factory method - should call startWorkers', async () => {
	const spy = jest.spyOn(MediaService.prototype, 'startWorkers');

	await MediaService.create(emptyMediaServiceOptions);

	expect(spy).toHaveBeenCalled();
});

test('startWorkers() - should have one workers', async () => {
	const spyObserver = new EventEmitter() as unknown as EnhancedEventEmitter;
	const mockWorker = new WorkerMock(spyObserver, 1) as unknown as Worker;
	const spyCreateWorker = jest.spyOn(mediasoup, 'createWorker').mockImplementation(async () => {
		return mockWorker;
	});
	const sut = new MediaService(emptyMediaServiceOptions);

	expect(sut.workers.length).toBe(0);

	await sut.startWorkers(optionsWithWorkers);

	expect(spyCreateWorker).toHaveBeenCalled();
	expect(sut.workers.length).toBe(1);
});

test('should restart worker if it dies', async () => {
	const spyObserver = new EventEmitter() as unknown as EnhancedEventEmitter;
	const mockWorker = new WorkerMock(spyObserver, 1) as unknown as Worker;
	const spyCreateWorker = jest.spyOn(mediasoup, 'createWorker').mockImplementationOnce(async () => {
		return mockWorker;
	});
	const sut = new MediaService(emptyMediaServiceOptions);
	const spyRemoveWorker = jest.spyOn(sut.workers, 'remove');
	const spyAddWorker = jest.spyOn(sut.workers, 'add');

	expect(spyCreateWorker).toHaveBeenCalledTimes(1);

	await sut.startWorkers(optionsWithWorkers);
	expect(spyRemoveWorker).toHaveBeenCalledTimes(0);
	expect(spyAddWorker).toHaveBeenCalledTimes(1);

	await mockWorker.emit('died', new Error);
	
	await TestUtils.sleep(10);
	expect(spyRemoveWorker).toHaveBeenCalledTimes(1);
	expect(spyAddWorker).toHaveBeenCalledTimes(2);
	expect(sut.workers.length).toBe(1);
});
