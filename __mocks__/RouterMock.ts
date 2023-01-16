import { Consumer } from 'mediasoup/node/lib/Consumer';
import { Producer } from 'mediasoup/node/lib/Producer';
import { Transport } from 'mediasoup/node/lib/Transport';

export default class RouterMock {
	appData = {
		pipeTransports: new Map(),
		pipeConsumers: new Map(),
		producers: new Map(),
		pipeProducers: new Map(),
		webRtcTransports: new Map(),
		consumers: new Map(),
		pipeDataConsumers: new Map(),
		dataConsumers: new Map(),
		dataProducers: new Map(),
		pipeDataProducers: new Map()
	};
	constructor(producer?: Producer, transport?: Transport, consumer?: Consumer) {
		if (producer) {
			this.appData.producers.set(producer.id, producer);
			this.appData.pipeProducers.set(producer.id, producer);
			this.appData.dataProducers.set(producer.id, producer);
			this.appData.pipeDataProducers.set(producer.id, producer);
		}
		if (transport) {
			this.appData.pipeTransports.set(transport.id, transport);
			this.appData.webRtcTransports.set(transport.id, transport);
		}
		if (consumer) {
			this.appData.pipeConsumers.set(consumer.id, consumer);
			this.appData.consumers.set(consumer.id, consumer);
			this.appData.pipeDataConsumers.set(consumer.id, consumer);
			this.appData.dataConsumers.set(consumer.id, consumer);
		}
	}

	close = jest.fn();
}