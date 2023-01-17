import { Consumer } from 'mediasoup/node/lib/Consumer';
import { Producer } from 'mediasoup/node/lib/Producer';

export default class TransportMock {
	#consumer;
	#producer;
	id = 'id';

	constructor(consumer?: Consumer, producer?: Producer) {
		if (consumer) {
			this.#consumer = consumer;
		}
		if (producer) {
			this.#producer = producer;
		}
	}

	consume = async () => {
		return this.#consumer ? this.#consumer : {};
	};
	consumeData = async () => {
		return this.#consumer ? this.#consumer : {};
	};
	produce = async () => {
		return this.#producer ? this.#producer : {};
	};
	produceData = async () => {
		return this.#producer ? this.#producer : {};
	};
}