import util from "util";
import winston from "winston";

function getCircularReplacer() {
    const seen = new WeakSet();
    return (_key: string, value: unknown) => {
        if (typeof value === "object" && value !== null) {
            if (seen.has(value)) {
                return "[Circular]";
            }
            seen.add(value);
        }
        return value;
    };
}

const level = process.env.LOG_LEVEL || "info";

const consoleFormat = winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaString = "";
    if (Object.keys(meta).length) {
        try {
            metaString = ` ${JSON.stringify(meta, getCircularReplacer())}`;
        } catch {
            metaString = ` ${util.inspect(meta, { depth: 4, breakLength: Infinity })}`;
        }
    }
    return `[${timestamp}] ${level}: ${message}${metaString}`;
});

export const logger = winston.createLogger({
    level,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true })
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(winston.format.colorize(), consoleFormat)
        })
    ]
});
