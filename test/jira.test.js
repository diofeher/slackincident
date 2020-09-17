const jira = require('../src/integrations/jira');

test('test if Jira functions are working', () => {
    jira.createFollowupsEpic();
})
