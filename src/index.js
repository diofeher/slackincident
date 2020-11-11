'use strict';

require('dotenv').config();
const pagerduty = require('./integrations/pagerduty');
const crypto = require('crypto');
const qs = require('qs');
const { onBreakGlass } = require('./break-glass');
const {
    createFlow,
    createPrivateFlow,
    onIncidentManagerResolved,
} = require('./incident');


const verifySlackWebhook = async(req, res, next) => {
    const { body } = req;
    if (!body || body.token !== process.env.SLACK_COMMAND_TOKEN) {
        const error = new Error('Invalid credentials');
        error.code = 401;
        throw error;
    }
}

// Main application
var express = require('express');
var app = express();
var bodyParser = require('body-parser');
app.use(bodyParser.json())
   .use(bodyParser.urlencoded());

app.post('/pagerduty', (req, res, next) => {
    console.debug('Sucessfully received pagerduty webhook from pagerduty.');
    const post = req.body;
    if(post.messages){
        for (var i = 0; i < post.messages.length; i++) {
            var message = post.messages[i];
            if(message['event'] == 'incident.acknowledge'){
                console.debug('incident acknowledgement.');
                pagerduty.onIncidentManagerAcknowledge(message);
            } else if(message['event'] == 'incident.resolve') {
                console.debug('incident resolved.');
                onIncidentManagerResolved(message);
            }
        }
    }
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({
        text: "OK"
    }));
    res.end();
});

app.post('/break-glass', async (req, res, next) => {
    await verifySlackWebhook(req, res, next);
    onBreakGlass(req.body, res, next);
});

app.post('/', async (req, res, next) => {
    await verifySlackWebhook(req, res, next);
    createFlow(req, res, false);
});

app.post('/security', async (req, res, next) => {
    await verifySlackWebhook(req, res, next);
    createPrivateFlow(req, res);
});


app.use(function (err, req, res, next) {
    console.error('ERROR', req.body, err.code, err.message);
    res.writeHead(err.code || 500, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({text: err.message}));
    res.end();
});

const port = process.env.PORT || 8080;
app.listen(port);
console.log(`Server listening on port ${port}.`);
