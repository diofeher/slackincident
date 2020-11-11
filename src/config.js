const CONSTANTS = {
    BREAK_GLASS_TIMEOUT: (process.env.BREAK_GLASS_TIMEOUT || 30) * 60,  // minutes
    BREAK_GLASS_MINIMUM_LEN_DESCRIPTION: 10, // chars
}

const COLORS = {
    RED: '#FF0000',
    GREEN: '#008000',
}

const INCIDENT = {
    SECURITY_MANAGERS: process.env.SECURITY_MANAGERS || '',
}

module.exports = {
    COLORS,
    CONSTANTS,
    INCIDENT,
}
