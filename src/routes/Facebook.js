const line = require('@line/bot-sdk');
const axios = require('axios');
const config = require('../config');
const { create, find } = require('../utils/mongodb');
const { saveUserData } = require('../components/Users');
const fastifyJwt = require('fastify-jwt');
const SessionManager = require('../components/Workflows');

const Facebook = (app, option, next) => {
	function verifyToken(req, reply) {
		const bearer = req.headers['authorization'];
		if (typeof bearer !== 'undefined') {
			const token = bearer.split(' ')[1];
			app.jwt.verify(token, err => {
				err ? reply.status(401).send('token invalid !') : '';
			});
		} else {
			return reply.status(401).send('token invalid !');
		}
	}

	async function seenMessage(userId) {
		const facebookContent = {
			messaging_type: 'RESPONSE',
			recipient: {
				id: userId,
			},
			sender_action: 'mark_seen',
		};
		console.log('Send seen message');
		const url = `${config.facebookGraphUrl}/${
			config.pageid
		}/messages?access_token=${config.pageToken}`;
		await axios.post(url, facebookContent);
	}
	const dbName = config.dbName;
	const configLine = {
		channelAccessToken: config.channelAccessToken,
		channelSecret: config.channelSecret,
	};
	const client = new line.Client(configLine);

	app.register(fastifyJwt, { secret: `${config.secret}` });

	app.post('/api/messenger/receive/', async(req, reply) => {
		const data = req.body.data;
		console.log('[Facebook]');
		const userId = data.entry[0].messaging[0].sender.id;
		const incomingMessage = data.entry[0].messaging[0].message;
		let receiveMessage = incomingMessage;
		console.log(`Receive Message from UserID: ${userId}`);
		console.log(`Content: ${JSON.stringify(incomingMessage)}`);
		const logData = {
			userId,
			receiveMessage,
		};
		if (typeof incomingMessage === 'undefined') {
			console.log('Receive unknown message');
			await seenMessage(userId);
			reply.status(200).send({ repsoneMessage: 'receive unknown message ' });

			return;
		}
		try {
			// function to keep user input
			await create(app, dbName, 'Logs', logData);
			// await saveUserData(userId, app, 'facebook');
			const currentSession = await SessionManager.currentSession(app, userId);
			if (currentSession !== undefined && currentSession.status !== 'finish') {
				console.log('Continues execute workflow');
				await SessionManager.nextStateWorkflow(app, userId);
				await SessionManager.sendState(app, userId, 'facebook');
			} else {
				const keyword = incomingMessage.text;
				const workflow = await SessionManager.getWorkflowByKeyword(app,
					keyword);
				if ((workflow && workflow._id) !== undefined) {
					console.log('Excute workflow by keyword ', keyword);
					await SessionManager.startWorkflow(app, userId, workflow._id);
					await SessionManager.sendState(app, userId, 'facebook');
				} else {
					await seenMessage(userId);
				}
			}
			reply.status(200).send({ repsoneMessage: 'receive message' });
		} catch (error) {
			reply.status(500).send({ error: error.stack });
			console.log(error.stack);
		}
	});

	app.post('/api/messenger/sendmsg/', async(req, reply) => {
		verifyToken(req, reply);
		const replyContent = req.body.replycontent;
		const userId = req.query.userid;
		if (typeof userId === 'undefined' || userId === '') {
			return reply.status(401).send('require userid');
		}
		console.log('to : ', userId);
		console.log(replyContent);
		const logData = {
			userId,
			replyMessage: replyContent,
		};

		try {
			await create(app, dbName, 'Logs', logData);
			await saveUserData(client, userId, app);
			await client.pushMessage(userId, replyContent);
			reply
				.status(200)
				.send({ repsoneMessage: `1 Content Sended to ID: ${userId}` });
		} catch (error) {
			reply.status(500).send({ error: error.stack });
			console.log(error.stack);
		}
	});

	app.get('/api/messenger/logs/', async(req, reply) => {
		verifyToken(req, reply);
		const lineid = req.query.userid;
		let filter = {};

		if (lineid !== undefined) {
			filter = {
				userId: lineid,
			};
			console.log('find logs by lineid', lineid);
		} else {
			console.log('find all logs');
		}

		try {
			const logs = await find(app, dbName, 'Logs', filter, { _id: -1 });
			reply.send(logs);
		} catch (error) {
			reply.status(500).send({ error: error.stack });
			console.log(error.stack);
		}
	});

	app.get('/gtoken', (req, reply) => {
		reply.jwtSign({ SurpiceMother: 'fucker' }, (err, token) => {
			if (err) console.log(err.stack);

			return reply.send(err || { token });
		});
	});
	next();
};
module.exports = Facebook;
