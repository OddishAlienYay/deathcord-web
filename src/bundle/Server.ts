process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

import http from "http";
import * as Api from "@fosscord/api";
import * as Gateway from "@fosscord/gateway";
import { CDNServer } from "@fosscord/cdn";
import express from "express";
import { green, bold, yellow } from "picocolors";
import { Config, initDatabase, BannedWords } from "@fosscord/util";
import * as Sentry from "@sentry/node";
import * as Tracing from "@sentry/tracing";

const app = express();
const server = http.createServer();
const port = Number(process.env.PORT) || 3001;
const production = process.env.NODE_ENV == "development" ? false : true;
server.on("request", app);

const api = new Api.FosscordServer({ server, port, production, app });
const cdn = new CDNServer({ server, port, production, app });
const gateway = new Gateway.Server({ server, port, production });

//this is what has been added for the /stop API route
process.on("SIGTERM", () => {
	server.close(() => {
		console.log("Stop API has been successfully POSTed, SIGTERM sent");
	});
});
//this is what has been added for the /stop API route

async function main() {
	await initDatabase();
	await Config.init();
	await BannedWords.init();
	// only set endpointPublic, if not already set
	await Config.set({
		cdn: {
			endpointClient: "${location.host}",
			endpointPrivate: `http://localhost:${port}`,
		},
		gateway: {
			endpointClient:
				'${location.protocol === "https:" ? "wss://" : "ws://"}${location.host}',
			endpointPrivate: `ws://localhost:${port}`,
			...(!Config.get().gateway.endpointPublic && {
				endpointPublic: `ws://localhost:${port}`,
			}),
		},
		// regions: {
		// 	default: "fosscord",
		// 	useDefaultAsOptimal: true,
		// 	available: [
		// 		{
		// 			id: "fosscord",
		// 			name: "Fosscord",
		// 			endpoint: "slowcord.maddy.k.vu:3004",
		// 			vip: false,
		// 			custom: false,
		// 			deprecated: false,
		// 		},
		// 	],
		// },
	} as any);

	//Sentry
	if (Config.get().sentry.enabled) {
		console.log(
			`[Bundle] ${yellow(
				"You are using Sentry! This may slightly impact performance on large loads!",
			)}`,
		);
		Sentry.init({
			dsn: Config.get().sentry.endpoint,
			integrations: [
				new Sentry.Integrations.Http({ tracing: true }),
				new Tracing.Integrations.Express({ app }),
				new Tracing.Integrations.Mysql(),
			],
			tracesSampleRate: Config.get().sentry.traceSampleRate,
			environment: Config.get().sentry.environment,
		});

		Sentry.addGlobalEventProcessor((event, hint) => {
			if (event.transaction) {
				event.transaction = event.transaction
					.split("/")
					.map((x) => (!parseInt(x) ? x : ":id"))
					.join("/");
			}

			delete event.request?.cookies;
			if (event.request?.headers) {
				delete event.request.headers["X-Real-Ip"];
				delete event.request.headers["X-Forwarded-For"];
				delete event.request.headers["X-Forwarded-Host"];
				delete event.request.headers["X-Super-Properties"];
			}

			if (event.breadcrumbs) {
				event.breadcrumbs = event.breadcrumbs.filter((x) => {
					if (x.message?.includes("identified as")) return false;
					if (x.message?.includes("[WebSocket] closed")) return false;
					if (
						x.message?.includes(
							"Got Resume -> cancel not implemented",
						)
					)
						return false;
					if (x.message?.includes("[Gateway] New connection from"))
						return false;

					return true;
				});
			}

			return event;
		});

		app.use(Sentry.Handlers.requestHandler());
		app.use(Sentry.Handlers.tracingHandler());
	}

	server.listen(port);
	await Promise.all([api.start(), cdn.start(), gateway.start()]);

	if (Config.get().sentry.enabled) {
		app.use(Sentry.Handlers.errorHandler());
		app.use(function onError(err: any, req: any, res: any, next: any) {
			res.statusCode = 500;
			res.end(res.sentry + "\n");
		});
	}

	console.log(`[Server] ${green(`listening on port ${bold(port)}`)}`);
}

main().catch(console.error);
