var redis = require('redis');
const util = require('util');
const bluebird = require("bluebird");
var moment = require('moment');
const uuidv4 = require('uuid/v4');
var moment = require('moment');

function escape(str){
  return str.replace(/([,.<>{}\[\]":;!@#$%^&*()\-+=~ ])/g,'\\$1')
}

function create_json_object(obj_arr){
      let obj = {}
      for (let i = 0; i < obj_arr.length; i = i+2) {
           obj[ obj_arr[i]]= obj_arr[i+1]
      }
      return obj;

}

function process_order_created_event(obj){
    return create_json_object(obj.data);
}

/*
 * Read a order id from  StreamOrderAggregate
 * Seach all the events for a Order and calculate the current state
 * Update the Order view for the Order id
 */
async function main(){
  var redisHost = process.env.redisHost || '127.0.0.1';
  var redisPort = parseInt(process.env.redisPort) || 6378;

  console.log("conneting to " + redisHost + ":" + redisPort )

  var redisClient = redis.createClient({host : redisHost, port : redisPort});

  bluebird.promisifyAll(redis.RedisClient.prototype);
  bluebird.promisifyAll(redis.Multi.prototype);


  try {
     var key =  await redisClient.getAsync('OffsetOrderAggregate');

     if(key == null){
       key = '0-0' 
     }

     for(;;){
        let rtnVal = await redisClient.xreadAsync('COUNT', 10, 
                                                  'BLOCK',1000,'STREAMS',
                                                  'StreamOrderAggregate',key )

        if( rtnVal != null){
           for(let j = 0; j < rtnVal[0][1].length; j++){
              // process()
              key = rtnVal[0][1][j][0];
              //console.log(rtnVal[0][1][j][1][1]);

              let streamPayload = JSON.parse(rtnVal[0][1][j][1][1])

              let searchKey = '@user:'+escape(streamPayload.user)+' @id:'+escape(streamPayload.orderId)
              console.log('..... searchKey : ' +searchKey)

              /* 
               * Get all the rows form event_store for 
               * given orderID with ASC order
               */
              var searchResults =  await redisClient.send_commandAsync('FT.SEARCH',['event_store', searchKey , 
                                                                              'SORTBY', 'timeStamp', 'ASC']) 

              let CurrentOrderView = {}
              let timeStamp = moment().unix()

              /*
               *  Loop through all the events of the order  
               *  to calculate the current state of the order
               */
              for(i = 1 ; i <= searchResults[0]; i++){

                  let searchResult = searchResults[i*2]
                  console.log(searchResult)
                  searchResultJsonObj = create_json_object(searchResult)
                  //console.log(searchResultJsonObj)

                  /*
                   * Prcoss the OrderCreatedEvent 
                   */
                  if( searchResultJsonObj.eventType == 'OrderCreatedEvent' ){
                    CurrentOrderView=JSON.parse(searchResultJsonObj.data);
                    console.log(CurrentOrderView)
                    console.log()
                  }
        
                  /*
                   * Prcoss the PaymentEvent 
                   */
                  if( searchResultJsonObj.eventType == 'PaymentEvent'){

                    CurrentOrderViewTmp = JSON.parse(searchResultJsonObj.data)
                    CurrentOrderView.status = CurrentOrderViewTmp.status
                    console.log(CurrentOrderView)
                    console.log()
                  } 
              }
              console.log("--------------------------------------------")

              /*
               * Add or Replace View Store for Order
               */
              var rtn =  await redisClient.send_commandAsync('FT.ADD',['order_view', escape(streamPayload.orderId), 
                                                                                    '1.0', 'REPLACE', 'FIELDS',  
                                                                                    'user', escape(streamPayload.user), 
                                                                                    'timeStamp', timeStamp, 
                                                                                    'data',  JSON.stringify(CurrentOrderView) ] )
              //console.log(rtn)
          }
       }
       redisClient.set('OffsetOrderAggregate',key)           

      }
  }
  catch(error) {
    console.error(error);
  }
}

main()
