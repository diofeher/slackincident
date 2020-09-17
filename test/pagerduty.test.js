const pagerduty = require('../src/integrations/pagerduty');

test('test if pagerduty functions are working', () => {
    pagerduty.getIncidentManagerEmail();
})
