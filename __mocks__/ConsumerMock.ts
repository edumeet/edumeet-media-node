import EventEmitter from 'events';

type appData = {
    remoteClosed: boolean
}

export default class ConsumerMock extends EventEmitter {
	id = 'id';
	kind = 'video';
	rtpParameters = 'rtp';
	sctpStreamParameters = 'sctp';
	producerPaused = false;
	observer: EventEmitter;
	appData: appData = { remoteClosed: false };
	paused = false;
	label = 'label';
	protocol = 'protocol';

	constructor(observer: EventEmitter) {
		super();
		this.observer = observer;
	}

	close = jest.fn();
	pause = jest.fn();
	resume = jest.fn();
	setPreferredLayers = jest.fn();
	requestKeyFrame = jest.fn();
	setPriority = jest.fn();
}