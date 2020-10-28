const { COLORS, CONSTANTS } = require('./config');
const pagerduty = require('./integrations/pagerduty');
const slack = require('./integrations/slack');


const testIfIsChannelIncident = async(channelId, userId) => {
    const { bot_id } = await slack.getProfileInfo();
    const botUserInfo = await slack.getBotInfo(bot_id);
    const { channel } = await slack.getChannelInfo(channelId);

    if (botUserInfo.user_id != channel.creator) {
        var slackMessage = {
            icon_emoji: ':x:',
            attachments: [{
                color: COLORS.RED,
                text: `This command can be used only on channels created by the bot. Break glass won't work here.`,
            }]
        };
        slack.sendSlackMessageToChannel(userId, slackMessage);
        return true;
    }
    return false;
}

const testTotalActiveIncidents = async (userId) => {
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
        return true;
    }
    return false;
}

const testTimeout = async(channelId, username) => {
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
        slack.sendSlackMessageToChannel(channelId, slackMessage);
        return true;
    }
    return false;
}

const testMinimumLength = async(userId, text) => {
    if(text.length < CONSTANTS.BREAK_GLASS_MINIMUM_LEN_DESCRIPTION) {
        var slackMessage = {
            icon_emoji: ':x:',
            attachments: [{
                color: COLORS.RED,
                text: `You need to specify a good description (minimum ${CONSTANTS.BREAK_GLASS_MINIMUM_LEN_DESCRIPTION} characters) when using /break-glass. Use like: /break-glass I want superpowers!`,
            }]
        };
        slack.sendSlackMessageToChannel(userId, slackMessage);
        return true;
    }
    return false;
}

const onBreakGlass = async (body) => {
    const { text, channel_id, user_name, user_id } = body;

    const errors = Promise.all([
        await testMinimumLength(user_id, text),
        await testTotalActiveIncidents(user_id),
        await testIfIsChannelIncident(channel_id, user_id),
        await testTimeout(channel_id, user_name),
    ])

    if(errors.some(Boolean)) {
        return;
    };

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
