const slack = require('../src/integrations/slack');

test('test if Slack functions are working', () => {
    slack.createInitialMessage()
    slack.sendSlackMessageToChannel()
    slack.setChannelTopic()
    slack.createSlackChannel()
})

