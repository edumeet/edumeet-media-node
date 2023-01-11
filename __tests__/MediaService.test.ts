// Mocks
import * as mediasoup from 'mediasoup';
jest.mock('mediasoup');
import { Worker } from 'mediasoup/node/lib/Worker';
jest.mock('mediasoup/node/lib/Worker');
import { WebRtcServer } from 'mediasoup/node/lib/WebRtcServer';
jest.mock('@observertc/sfu-monitor-js');

import 'jest';
import MediaService, { MediaServiceOptions } from '../src/MediaService';
import * as observeRtcMock from '@observertc/sfu-monitor-js';

test('Constructor', () => {
	const fakeOptions = {} as unknown as MediaServiceOptions;
	const m = new MediaService(fakeOptions);

	expect(true).toBe(true);
});

test('Factory method - should call startWorkers', async () => {
	const fakeOptions = {} as unknown as MediaServiceOptions;

	const spy = jest.spyOn(MediaService.prototype, 'startWorkers');

	await MediaService.create(fakeOptions);

	expect(spy).toHaveBeenCalled();
});

test('Constructor - useObserveRTC:true should call createMediasoupMonitor', async () => {
	const spy = jest.spyOn(observeRtcMock, 'createMediasoupMonitor');
	const useObserveRTCOptions = {
		useObserveRTC: true
	} as unknown as MediaServiceOptions;

	await new MediaService(useObserveRTCOptions);

	expect(spy).toHaveBeenCalled();
});

test('Close() - Should close', () => {
	const fakeOptions = {} as unknown as MediaServiceOptions;
	const m = new MediaService(fakeOptions);

	m.close();
	expect(m.closed).toBeTruthy();
	expect(m['workers'].length).toBe(0);
});

test('getRouter()', async () => {
	const fakeOptions = {} as unknown as MediaServiceOptions;
	const fakeOptions2 = {
		rtcMinPort: 1,
		rtcMaxPort: 2,
		numberOfWorkers: 2 
	} as unknown as MediaServiceOptions;
	const spyCreateWebRtcServer = jest.fn().mockReturnValue({});
	const spyObserver = {
		on: jest.fn()
	};

	const m = new MediaService(fakeOptions);

	jest.spyOn(mediasoup, 'createWorker').mockImplementation(async () => {
		return {
			createWebRtcServer: spyCreateWebRtcServer,
			appData: {},
			observer: spyObserver,
			once: jest.fn()
		} as unknown as Worker;
	});
	jest.spyOn(Worker.prototype, 'createWebRtcServer').mockImplementation(async () => {
		return {} as WebRtcServer;
	});

	await m.startWorkers(fakeOptions2);

	// await m.getRouter('id');

});