const http = require('http');
const crypto = require('crypto');

const clients = new Set();

function constructFrame(text) {
  const payload = Buffer.from(text);
  const length = payload.length;
  let frame = [0x81];
  if (length <= 125) {
    frame.push(length);
  } else if (length <= 65535) {
    frame.push(126, (length >> 8) & 255, length & 255);
  } else {
    frame.push(127, 0, 0, 0, 0, (length >> 24) & 255, (length >> 16) & 255, (length >> 8) & 255, length & 255);
  }
  return Buffer.concat([Buffer.from(frame), payload]);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket Server Running');
});

server.on('upgrade', (req, socket) => {
  if (req.headers['upgrade'] !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request');
    return;
  }

  const key = req.headers['sec-websocket-key'];
  const acceptKey = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n'
  ].join('\r\n'));

  clients.add(socket);

  socket.on('data', (buffer) => {
    const opCode = buffer[0] & 0x0F;
    if (opCode === 0x8) {
      clients.delete(socket);
      socket.end();
      return;
    }

    if (opCode === 0x1) {
      const secondByte = buffer[1];
      const isMasked = (secondByte >>> 7) & 0x1;
      let length = secondByte & 0x7F;
      let offset = 2;

      if (length === 126) { length = buffer.readUInt16BE(offset); offset += 2; }
      else if (length === 127) { length = Number(buffer.readBigUInt64BE(offset)); offset += 8; }

      if (isMasked) {
        const mask = buffer.slice(offset, offset + 4);
        offset += 4;
        const payload = buffer.slice(offset, offset + length);
        const decoded = Buffer.alloc(length);
        for (let i = 0; i < length; i++) decoded[i] = payload[i] ^ mask[i % 4];
        
        const message = decoded.toString();
        const broadcastFrame = constructFrame(message);
        clients.forEach(client => {
          if (client.writable) client.write(broadcastFrame);
        });
      }
    }
  });

  socket.on('error', () => clients.delete(socket));
  socket.on('close', () => clients.delete(socket));
});

server.listen(8080, () => console.log('Server on port 8080'));
