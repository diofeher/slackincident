const { COLORS, CONSTANTS } = require('./config');
const pagerduty = require('./integrations/pagerduty');
const slack = require('./integrations/slack');


const onBreakGlass = async (body) => {
    const { text, channel_id, user_name, user_id } = body;
    if(text.length < CONSTANTS.BREAK_GLASS_MINIMUM_LEN_DESCRIPTION) {
        var slackMessage = {
            icon_emoji: ':x:',
            attachments: [{
                color: COLORS.RED,
                text: `You need to specify a description when using /break-glass. Use like: /break-glass I want superpowers!`,
            }]
        };
        slack.sendSlackMessageToChannel(user_id, slackMessage);
        return;
    }

    const totalActiveEvents = await pagerduty.getTotalActiveIncidents();
    if (totalActiveEvents == 0) {
        var slackMessage = {
            icon_emoji: ':x:',
            attachments: [{
                color: COLORS.RED,
                text: `There's no active incidents, you can't break the glass.`,
            }]
        };
        slack.sendSlackMessageToChannel(user_id, slackMessage);
        return;
    }

    const currentTime = new Date();
    const pagerDutyDetails = await pagerduty.getIncidentBySlackChannel(channel_id);
    const incidentCreatedTime = new Date(pagerDutyDetails.created_at);
    const delta = (currentTime - incidentCreatedTime);

    if (delta / 1000 > CONSTANTS.BREAK_GLASS_OFFTIME) {
        var slackMessage = {
            icon_emoji: ':x:',
            attachments: [{
                text: `${user_name} cannot break the glass anymore. Time has passed.`,
                color: COLORS.RED,
            }],
        };
        slack.sendSlackMessageToChannel(channel_id, slackMessage);
        return;
    }

    const { bot_id } = await slack.getProfileInfo();
    const botUserInfo = await slack.getBotInfo(bot_id);
    const { channel } = await slack.getChannelInfo(channel_id);

    if (botUserInfo.user_id != channel.creator) {
        var slackMessage = {
            icon_emoji: ':x:',
            attachments: [{
                color: COLORS.RED,
                text: `This command can be used only on channels created by the bot. Break glass won't work here.`,
            }]
        };
        slack.sendSlackMessageToChannel(user_id, slackMessage);
        return;
    }

    var slackMessage = {
        icon_emoji: ':fire_engine:',
        attachments: [{
            text: `${user_name} broke the glass: "${text}"`,
            color: COLORS.RED,
        }],
    };

    slack.sendSlackMessageToChannel(channel_id, slackMessage);
    const userInfo = await slack.getProfileInfo(user_id);
    googleapi.addUserToGroup(userInfo.email, false);
}

module.exports = {
    onBreakGlass,
}
