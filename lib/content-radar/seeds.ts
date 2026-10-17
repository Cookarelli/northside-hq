export const SOURCE_SEEDS=[
 {key:'topps-ripped',name:'Topps RIPPED',url:'https://ripped.topps.com/',category:'Baseball',priority:'high'},
 {key:'topps-calendar',name:'Topps Release Calendar',url:'https://www.topps.com/release-calendar',category:'Baseball',priority:'high'},
 {key:'fanatics-news',name:'Fanatics official news',url:'https://www.fanaticsinc.com/press-releases/',category:'Memorabilia',priority:'high'},
 {key:'fanatics-collect-news',name:'Fanatics Collect newsroom',url:'https://www.fanaticscollect.com/newsroom',category:'Auctions',priority:'high'},
 {key:'dave-adams-news',name:"Dave & Adam's Card World",url:'https://www.dacardworld.com/blog/',category:'Baseball',priority:'normal'},
 {key:'steel-city',name:'Steel City Collectibles',url:'https://www.steelcitycollectibles.com/',category:'Baseball',priority:'normal'},
 // No public licensed API contract is configured. Never collect subscription market data from pages.
 {key:'card-ladder-licensed',name:'Card Ladder (licensed access required)',url:'https://www.cardladder.com/',category:'Baseball',priority:'normal',social:true},
 {key:'beckett-calendar',name:'Beckett Release Calendar',url:'https://www.beckett.com/news/sports-card-release-calendar-dates/',category:'Baseball',priority:'high'},
 {key:'cardboard-connection',name:'Cardboard Connection',url:'https://www.cardboardconnection.com/',category:'Baseball',priority:'normal'},
 // Advertised by the publisher's RSS link; validated again before each import.
 {key:'pokebeach',name:'PokeBeach',url:'https://www.pokebeach.com/',category:'Pokemon',priority:'high',feed:'https://www.pokebeach.com/forums/forum/-/index.rss'},
 {key:'pokeguardian',name:'PokeGuardian',url:'https://www.pokeguardian.com/',category:'Pokemon',priority:'high'},
 ...[['topps','Topps','Baseball'],['paniniamerica','Panini America','Football'],['upperdecksports','Upper Deck','Hockey'],['pokemon','Pokemon','Pokemon'],['collect','Fanatics Collect','Memorabilia'],['cardladder','Card Ladder','Baseball'],['psacard','PSA','Memorabilia'],['sportscardinvestor','Sports Card Investor','Baseball'],['packmancards','Packman','Basketball'],['tcgplayer_com','TCGplayer','Other TCG'],['chicagosportsshow','Chicago Sports Spectacular','Local Events']].map(([handle,name,category])=>({key:'instagram-'+handle,name,url:`https://www.instagram.com/${handle}/`,category,priority:'normal',social:true})),
] as {key:string;name:string;url:string;category:string;priority:string;feed?:string;social?:boolean}[];
