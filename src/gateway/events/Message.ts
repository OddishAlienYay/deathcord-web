import { WebSocket, Payload, CLOSECODES, OPCODES } from "@fosscord/gateway";
import OPCodeHandlers from "../opcodes";
import { check } from "../opcodes/instanceOf";
import WS from "ws";
import { PayloadSchema } from "@fosscord/util";
import * as Sentry from "@sentry/node";
import BigIntJson from "json-bigint";
const bigIntJson = BigIntJson({ storeAsString: true });

var erlpack: any;
try {
	erlpack = require("@yukikaze-bot/erlpack");
} catch (error) { }

export async function Message(this: WebSocket, buffer: WS.Data) {
	// TODO: compression
	var data: Payload;

	if (this.encoding === "etf" && buffer instanceof Buffer)
		data = erlpack.unpack(buffer);
	else if (this.encoding === "json" && buffer instanceof Buffer && buffer[0] !== 123) {	// bad check for "{"
		if (this.inflate) {
			try {
				buffer = this.inflate.process(buffer) as any;
			} catch {
				buffer = buffer.toString() as any;
			}
		}
		data = bigIntJson.parse(buffer as string);
	} else if (typeof buffer == "string" || (buffer instanceof Buffer && buffer[0] == 123)) {
		data = bigIntJson.parse(buffer as string);
	} else return;

	check.call(this, PayloadSchema, data);

	// @ts-ignore
	const OPCodeHandler = OPCodeHandlers[data.op];
	if (!OPCodeHandler) {
		console.error("[Gateway] Unkown opcode " + data.op);
		// TODO: if all opcodes are implemented comment this out:
		// this.close(CLOSECODES.Unknown_opcode);
		return;
	}

	const transaction = Sentry.startTransaction({
		op: OPCODES[data.op],
		name: `GATEWAY ${OPCODES[data.op]}`,
		data: {
			...data.d,
			token: data?.d?.token ? "[Redacted]" : undefined,
		},
	});

	try {
		var ret = await OPCodeHandler.call(this, data);
		transaction.finish();
		return ret;
	} catch (error) {
		Sentry.captureException(error);
		transaction.finish();
		console.error(`Error: Op ${data.op}`, error);
		// if (!this.CLOSED && this.CLOSING)
		return this.close(CLOSECODES.Unknown_error);
	}
}
