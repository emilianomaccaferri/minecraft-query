import udp from "dgram";
import EventEmitter from "events";
import crypto from "crypto";

interface QueryProps {
    host: string;
    port: number;
    timeout?: number;
}

type FullStat = {
    motd: string;
    gametype: string;
    game_id: string;
    version: string;
    plugins: string;
    map: string;
    online_players: string;
    max_players: string;
    port: string;
    players: string[];
};

type BasicStat = {
    motd: string;
    gametype: string;
    map: string;
    online_players: string;
    max_players: string;
};

// https://wiki.vg/Query

class Query {
    emitter: EventEmitter;
    host: string;
    port: number;
    timeout: number;
    authenticating: boolean;
    basic_stat: boolean;
    sessionid: number;
    full_stat: boolean;
    closed: boolean;
    client: udp.Socket;

    constructor(obj: QueryProps) {
        this.emitter = new EventEmitter();
        this.host = obj.host;
        this.port = obj.port;
        this.timeout = obj.timeout || 5000;
        this.authenticating = false;
        this.basic_stat = false;
        this.sessionid = crypto.randomInt(2147483648); // a safe 32-bit integer
        this.full_stat = false;
        this.closed = false;
        this.client = udp.createSocket("udp4");

        this.client.on("message", (data, info) => {
            if (this.authenticating) {
                const t = parseInt(data.toString("utf-8", 5)); // got the token!
                this.emitter.emit("challenge_token", t);
                this.authenticating = false;
            }
            //Fix by @KevBelisle
            if (this.full_stat) {
                try {
                    const final = data
                        .toString("utf-8", 11)
                        .split("\x00\x01player_\x00\x00"); // splicing the output as suggested
                    const kv = final[0].split("\0");
                    const players = final[1].split("\0").filter((item) => {
                        return item != "";
                    });

                    this.emitter.emit("full_stat", {
                        motd: kv[3],
                        gametype: kv[5],
                        game_id: kv[7],
                        version: kv[9],
                        plugins: kv[11],
                        map: kv[13],
                        online_players: kv[15],
                        max_players: kv[17],
                        port: kv[19],
                        players,
                    });
                } catch (err) {
                    throw err;
                }
            }
            //Also added a catch for basic stat
            if (this.basic_stat) {
                try {
                    const final = data.toString().split("\0");
                    this.emitter.emit("basic_stat", {
                        motd: final[5],
                        gametype: final[6],
                        map: final[7],
                        online_players: final[8],
                        max_players: final[9],
                    });
                } catch (err) {
                    throw err;
                }
            }
        });
    }

    fullStat() {
        return new Promise<FullStat>(async (resolve, reject) => {
            // building the packet
            if (this.closed)
                return reject(
                    new Error("Cannot query if UDP connection is closed")
                );

            try {
                const token = await this._generateChallengeToken();
                const buffer = Buffer.alloc(15); // short + byte + int32 + int32 = 11 bytes
                buffer.writeUInt16BE(0xfefd, 0); // magic number, as usual
                buffer.writeUInt8(0, 2); // 0 for stat
                buffer.writeInt32BE(this.sessionid, 3); // our session id
                buffer.writeInt32BE(token, 7);
                buffer.writeInt32BE(0x00, 11);

                this.full_stat = true;

                this.emitter.once("full_stat", (stat: FullStat) => {
                    this.full_stat = false;
                    resolve(stat);
                });

                this.client.send(buffer, this.port, this.host, (err) => {
                    if (err) {
                        reject(err);
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    basicStat() {
        return new Promise<BasicStat>(async (resolve, reject) => {
            if (this.closed)
                return reject(
                    new Error("Cannot query if UDP connection is closed")
                );

            // building the packet
            try {
                const token = await this._generateChallengeToken();
                const buffer = Buffer.alloc(11); // short + byte + int32 + int32 = 11 bytes
                buffer.writeUInt16BE(0xfefd, 0); // magic number, as usual
                buffer.writeUInt8(0, 2); // 0 is basic stat
                buffer.writeInt32BE(this.sessionid, 3); // our session id
                buffer.writeInt32BE(token, 7);
                this.basic_stat = true;

                this.emitter.once("basic_stat", (stat: BasicStat) => {
                    this.basic_stat = false;
                    resolve(stat);
                });

                this.client.send(buffer, this.port, this.host, (err) => {
                    if (err) reject(err);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    close() {
        this.closed = true;
        this.client.close();
    }

    private _generateChallengeToken() {
        return new Promise<number>((resolve, reject) => {
            // building the packet

            const buffer = Buffer.alloc(7);
            buffer.writeUInt16BE(0xfefd, 0); // magic number
            buffer.writeUInt8(9, 2); // 9 is handshake
            buffer.writeInt32BE(this.sessionid, 3); // this.sessionid is our sessionid
            buffer.write("", 7); // empty payload
            this.authenticating = true;

            const timeout = setTimeout(() => {
                // take advantage of lexical bindings in arrow functions
                reject(
                    new Error(
                        `Challenge token generation timeout: ${this.host}`
                    )
                );
            }, this.timeout);

            this.client.send(buffer, this.port, this.host, (err) => {
                if (err) {
                    reject(err);
                }

                this.emitter.once("challenge_token", (token: number) => {
                    clearTimeout(timeout);
                    this.authenticating = false;
                    resolve(token);
                });
            });
        });
    }
}

export default Query;
export { Query, QueryProps, FullStat, BasicStat };
