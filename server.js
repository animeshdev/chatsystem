var conf = { 
    port: 5000,
    debug: false,
    dbPort: 6379,
    dbHost: '127.0.0.1',
    dbOptions: {},
    mainroom: 'Main'
};

// External dependencies
var express = require('express'),
    http = require('http'),
    bodyParser = require('body-parser'),
    socketio = require('socket.io'),
    events = require('events'),
    _ = require('underscore'),
    redis = require('redis'),
    sanitize = require('validator').sanitize;

// HTTP Server configuration & launch
var app = express(),
    server = http.createServer(app),
    io = socketio.listen(server);
server.listen(conf.port);

// app.use(express.bodyParser());
// app.use(express.static(__dirname + '/public'));

// Socket.io store configuration
var RedisStore = require('socket.io-redis'),
    pub = redis.createClient(conf.dbPort, conf.dbHost, conf.dbOptions),
    sub = redis.createClient(conf.dbPort, conf.dbHost, conf.dbOptions),
    db = redis.createClient(conf.dbPort, conf.dbHost, conf.dbOptions);
io.set('store', new RedisStore({
    redisPub: pub,
    redisSub: sub,
    redisClient: db
}));
io.set('log level', 1);

// Logger configuration
var logger = new events.EventEmitter();
logger.on('newEvent', function(event, data) {
    // Console log
    console.log('%s: %s', event, JSON.stringify(data));
    // Persistent log storage too?
    // TODO
});

// ***************************************************************************
// Express routes helpers
// ***************************************************************************

// Only authenticated users should be able to use protected methods
var requireAuthentication = function(req, res, next) {
    
    // TODO
    next();
};

// Sanitize message to avoid security problems
var sanitizeMessage = function(req, res, next) {
    if (req.body.msg) {
        req.sanitizedMessage = sanitize(req.body.msg).xss();
        next();
    } else {
        res.send(400, "No message provided");
    }
};

// Send a message to all active rooms
var sendBroadcast = function(text) {
    _.each(_.keys(socket.room), function(room) {
        room = room.substr(1); // Forward slash before room name (socket.io)
        // Don't send messages to default "" room 
        if (room) {
            var message = {'room':room, 'username':'ServerBot', 'msg':text, 'date':new Date()};
            io.sockets.in(room).emit('newMessage', message);
        }
    });
    logger.emit('newEvent', 'newBroadcastMessage', {'msg':text});
};

// ***************************************************************************
// Express routes
// ***************************************************************************
app.use(bodyParser.json())
.use(express.static('./public'))
// Welcome message
.get('/', function(req, res) {
    res.sendfile('public/main.html');
})

// Broadcast message to all connected users
.post('/api/broadcast/', requireAuthentication, sanitizeMessage, function(req, res) {
    sendBroadcast(req.sanitizedMessage);
    res.send(201, "Message sent to all rooms");
}); 

// ***************************************************************************
// Socket.io events
// ***************************************************************************

io.sockets.on('connection', function(socket) {

    

    // Welcome message on connection
    socket.emit('connected', {text:'Welcome to the chat server','username':'chatroom'});
    //logger.emit('newEvent', 'userConnected', {'socket':socket.id});

    // Store user data in db
    db.hset([socket.id, 'connectionDate', new Date()], redis.print);
    db.hset([socket.id, 'socketID', socket.id], redis.print);
    db.hset([socket.id, 'username', 'anonymous'], redis.print);

    db.hget([socket.id, 'username'], function(err, username) {

        console.log(username);
    });

    // Join user to 'MainRoom'
    socket.join(conf.mainroom);

    //console.log( io.sockets.adapter.rooms );

    logger.emit('newEvent', 'userJoinsRoom', {'socket':socket.id, 'room':conf.mainroom});

    // Confirm subscription to user
    socket.emit('subscriptionConfirmed', {'room':conf.mainroom});

    //var message = {text:'----- anonymous Has Joined the room -----','username':'chatroom'}
    // Notify subscription to all users in room
    var data = {'room':conf.mainroom, 'username':'chatroom', 'text':'----- anonymous Has Joined the room -----', 'id':socket.id};
    io.sockets.in(conf.mainroom).emit('userJoinsRoom', data);

    // User wants to subscribe to [data.rooms]
    socket.on('subscribe', function(data) {
        // Get user info from db
        db.hget([socket.id, 'username'], function(err, username) {

            // Subscribe user to chosen rooms
            _.each(data.rooms, function(room) {
                room = room.replace(" ","");
                socket.join(room);
                logger.emit('newEvent', 'userJoinsRoom', {'socket':socket.id, 'username':username, 'room':room});

                // Confirm subscription to user
                socket.emit('subscriptionConfirmed', {'room': room});
        
                // Notify subscription to all users in room
                var message = {'room':room, 'username':username, 'text':'----- Joined the room -----', 'id':socket.id};
                io.sockets.in(room).emit('userJoinsRoom', message);
            });
        });
    });

    // User wants to unsubscribe from [data.rooms]
    socket.on('unsubscribe', function(data) {
        // Get user info from db
        db.hget([socket.id, 'username'], function(err, username) {
        
            // Unsubscribe user from chosen rooms
            _.each(data.rooms, function(room) {
                if (room != conf.mainroom) {
                    socket.leave(room);
                    logger.emit('newEvent', 'userLeavesRoom', {'socket':socket.id, 'username':username, 'room':room});
                
                    // Confirm unsubscription to user
                    socket.emit('unsubscriptionConfirmed', {'room': room});
        
                    // Notify unsubscription to all users in room
                    var message = {'room':room, 'username':username, 'text':'----- Left the room -----', 'id': socket.id};
                    io.sockets.in(room).emit('userLeavesRoom', message);
                }
            });
        });
    });

    // User wants to know what rooms he has joined
    socket.on('getRooms', function(data) {
        socket.emit('roomsReceived', socket.rooms);
        logger.emit('newEvent', 'userGetsRooms', {'socket':socket.id});
    });

    // Get users in given room
    socket.on('getUsersInRoom', function(data) {
        var usersInRoom = [];
        var socketsInRoom = _.keys ( io.sockets.adapter.rooms[data.room] );


        //console.log( socketsInRoom );

        for (var i=0; i<socketsInRoom.length; i++) {
            db.hgetall(socketsInRoom[i], function(err, obj) {

                console.log( obj );
                usersInRoom.push({ 'username':obj.username, 'id':obj.socketID });
                // When we've finished with the last one, notify user
                if (usersInRoom.length == socketsInRoom.length) {

                    usersInRoom.push({'username':'chatroom', 'id':''});
                    io.sockets.in(data.room).emit('usersInRoom', {'users':usersInRoom,'room':data.room});
                }
            });
        }

        //console.log( usersInRoom );

    });

    // User wants to change his nickname
    socket.on('setNickname', function(data) {

        //Get user info from db
        db.hget([socket.id, 'username'], function(err, username) {

            // Store user data in db
            db.hset([socket.id, 'username', data.username], redis.print);
            logger.emit('newEvent', 'userSetsNickname', {'socket':socket.id, 'oldUsername':username, 'newUsername':data.username});

            //io.sockets.adapter 

            // Notify all users who belong to the same rooms that this one
            _.each(socket.rooms, function(room) {
                //room = room.substr(1); // Forward slash before room name (socket.io)

                console.log('list:' + room);

                if (room && room != socket.id) {
                    var info = {'room':room, 'oldUsername':username, 'newUsername':data.username, 'id':socket.id};
                    io.sockets.in(room).emit('userNicknameUpdated', info);
                }
            });
        });



    });

    // New message sent to group
    socket.on('newMessage', function(data) {

        db.hgetall(socket.id, function(err, obj) {
            if (err) return logger.emit('newEvent', 'error', err);

            // Check if user is subscribed to room before sending his message
            //if (_.has(io.sockets.roomClients[socket.id], "/"+data.room)) {

            console.log( data );    

            if (_.contains( socket.rooms, data.room)) {

                //var msg = {'username':obj.username, 'text':data.msg };    
                var message = {'room':data.room, 'username':obj.username, 'text':data.msg, 'date':new Date()};
                // Send message to room
                io.sockets.in(data.room).emit('newMessage', message);
                logger.emit('newEvent', 'newMessage', message);
            } 
        });
    });

    // Clean up on disconnect
    socket.on('disconnect', function() {
    
        // Get current rooms of user
        //var rooms = _.clone(io.sockets.roomClients[socket.id]);

        var rooms = io.sockets.adapter.rooms ;
        
        // Get user info from db
        db.hgetall(socket.id, function(err, obj) {
            if (err) return logger.emit('newEvent', 'error', err);
            logger.emit('newEvent', 'userDisconnected', {'socket':socket.id, 'username':obj.username});

            // Notify all users who belong to the same rooms that this one
            _.each(_.keys(rooms), function(room) {
                //room = room.substr(1); // Forward slash before room name (socket.io)
                if (room) {
                    console.log('inside');
                    var message = {'room':room, 'username':obj.username, 'text':'----- Left the room -----', 'id':obj.socketID};
                    io.sockets.in(room).emit('userLeavesRoom', message);
                }
            });
        });
    
        // Delete user from db
        db.del(socket.id, redis.print);
    });
});



