/*!
 *
 * Squarespace template.
 *
 */
var request = require( "request" ),
    path = require( "path" ),
    fs = require( "fs" ),
    less = require( "less" ),
    uglifycss = require( "uglifycss" ),
    functions = require( "./lib/functions" ),
    blocktypes = require( "./lib/blocktypes" ),
    blockrenders = require( "./lib/blockrenders" ),
    sqsRequest = require( "./squarespace-request" ),
    sqsRender = require( "./squarespace-render" ),
    rSlash = /^\/|\/$/g,
    rHeader = /header/,
    rFooter = /footer/,
    rScripts = /<script.*?\>(.*?)<\/script\>/g,
    rBlockIncs = /\{\@\|apply\s(.*?)\}/g,
    rBlockTags = /^\{\@\|apply\s|\}$/g,
    rTplFiles = /\.item$|\.list$|\.region$/,
    rItemOrList = /\.item$|\.list$/,
    rRegions = /\.region$/,
    rItem = /\.item$/,
    rList = /\.list$/,
    rLess = /\.less$/,
    rSQSQuery = /(<squarespace:query.*?\>)(.*?)(<\/squarespace:query\>)/,
    rSQSNavis = /<squarespace:navigation(.*?)\/\>/g,
    rSQSBlockFields = /<squarespace:block-field(.*?)\/\>/g,
    rSQSScripts = /<squarespace:script(.*?)\/\>/g,
    rSQSClickThroughUrl = /\/s\/(.*?)\.\w+.*?/g,
    rSQSFootersFull = /<script type="text\/javascript" data-sqs-type="imageloader"\>(.*)<\/script\>/,
    rSQSHeadersFull = new RegExp( "<\\!-- This is Squarespace. -->(.*?)<\\!-- End of Squarespace Headers -->" ),
    SQS_HEADERS = "{squarespace-headers}",
    SQS_FOOTERS = "{squarespace-footers}",
    SQS_MAIN_CONTENT = "{squarespace.main-content}",
    SQS_PAGE_CLASSES = "{squarespace.page-classes}",
    SQS_PAGE_ID = "{squarespace.page-id}",
    SQS_POST_ENTRY = "{squarespace-post-entry}",
    sqsHeaders = [],
    sqsFooters = [],
    sqsUser = null,
    homepage = "homepage",
    directories = {},
    config = null,
    scripts = [],
    siteCss = null,
    header = null,
    footer = null,
    templates = {},


/******************************************************************************
 * @Public
*******************************************************************************/

/**
 *
 * @method setConfig
 * @param {object} conf The server configuration
 * @public
 *
 */
setConfig = function ( conf ) {
    config = conf;
},


/**
 *
 * @method setDirs
 * @param {object} conf The directories
 * @public
 *
 */
setDirs = function ( dirs ) {
    directories = dirs;
},


/**
 *
 * @method setUser
 * @param {object} conf The directories
 * @public
 *
 */
setUser = function ( user ) {
    sqsUser = user;
},


/**
 *
 * @method replaceSQSTags
 * @param {string} rendered The template rendering
 * @param {object} pageJson JSON data for page
 * @returns {string}
 * @private
 *
 */
replaceSQSTags = function ( rendered, pageJson ) {
    var pageType = pageJson.item ? "item" : "collection",
        pageId = pageJson.item ? pageJson.item.id : pageJson.collection.id;

    rendered = rendered.replace( SQS_MAIN_CONTENT, pageJson.mainContent );
    rendered = rendered.replace( SQS_PAGE_CLASSES, "" );
    rendered = rendered.replace( new RegExp( SQS_PAGE_ID, "g" ), (pageType + "-" + pageId) );
    rendered = rendered.replace( SQS_POST_ENTRY, "" );

    return rendered;
},


/**
 *
 * @method compileCollections
 * @public
 *
 */
compileCollections = function () {
    var collections = fs.readdirSync( directories.collections ),
        content = null,
        file = null,
        files = null;

    for ( var i = collections.length; i--; ) {
        if ( rItemOrList.test( collections[ i ] ) ) {
            content = "";
            file = path.join( directories.collections, collections[ i ] );
            files = [header, file, footer];

            for ( var j = 0, len = files.length; j < len; j++ ) {
                if ( fs.existsSync( files[ j ] ) ) {
                    content += functions.readFile( files[ j ] );
                }
            }

            templates[ collections[ i ] ] = content;
        }
    }
},


/**
 *
 * @method compileRegions
 * @public
 *
 */
compileRegions = function () {
    var files = null,
        file = null,
        link = null;

    for ( var i in config.layouts ) {
        files = config.layouts[ i ].regions;
        file = "";
        link = (i + ".region");

        for ( j = 0, len = files.length; j < len; j++ ) {
            file += functions.readFile( path.join( config.server.webroot, (files[ j ] + ".region") ) );
        }

        templates[ link ] = file;
    }
},


/**
 *
 * @method replaceBlocks
 * @public
 *
 */
replaceBlocks = function () {
    var matched,
        block,
        filed;

    for ( var i in templates ) {
        if ( !rTplFiles.test( i ) ) {
            continue;
        }

        while ( matched = templates[ i ].match( rBlockIncs ) ) {
            for ( var j = 0, len = matched.length; j < len; j++ ) {
                block = matched[ j ].replace( rBlockTags, "" );
                filed = functions.readFile( path.join( directories.blocks, block ) );

                templates[ i ] = templates[ i ].replace( matched[ j ], filed );
            }
        }
    }
},


/**
 *
 * @method replaceScripts
 * @public
 *
 */
replaceScripts = function () {
    var matched,
        token;

    for ( var i in templates ) {
        if ( !rTplFiles.test( i ) ) {
            continue;
        }

        matched = templates[ i ].match( rScripts );

        if ( matched ) {
            for ( var j = 0, len = matched.length; j < len; j++ ) {
                token = functions.getToken();
                scripts.push({
                    token: token,
                    script: matched[ j ]
                });

                templates[ i ] = templates[ i ].replace( matched[ j ], token );
            }
        }
    }
},


/**
 *
 * @method replaceSQSScripts
 * @public
 *
 */
replaceSQSScripts = function () {
    var matched,
        attrs,
        block,
        filed;

    for ( var i in templates ) {
        if ( !rTplFiles.test( i ) ) {
            continue;
        }

        matched = templates[ i ].match( rSQSScripts );

        if ( matched ) {
            for ( var j = 0, len = matched.length; j < len; j++ ) {
                attrs = functions.getAttrObj( matched[ j ] );
                block = ( "/scripts/" + attrs.src );
                filed = '<script src="' + block + '"></script>';

                templates[ i ] = templates[ i ].replace( matched[ j ], filed );
            }
        }
    }
},


/**
 *
 * @method getTemplate
 * @param {string} reqUri URI seg zero
 * @param {object} pageJson JSON data for page
 * @public
 *
 */
getTemplate = function ( reqUri, pageJson ) {
    var template = null,
        uriSegs = null,
        regcheck = null;

    if ( !pageJson ) {
        functions.log( "TEMPLATE - Page JSON UNDEFINED" );

        return;
    }

    if ( reqUri === "/" ) {
        uriSegs = [homepage];

    } else {
        uriSegs = reqUri.replace( rSlash, "" ).split( "/" );
    }

    // removed .*?
    regcheck = new RegExp( (uriSegs[ 0 ] + "\\."), "i" );

    for ( var tpl in templates ) {
        if ( !rTplFiles.test( tpl ) ) {
            continue;
        }

        // Homepage => This is a special case
        if ( pageJson.collection.homepage ) {
            // It is of type page, break and use region below
            if ( pageJson.collection.typeName === "page" && pageJson.collection.regionName ) {
                template = (pageJson.collection.regionName + ".region");
                break;

            // It is a collection and a .list of its type is located
            } else if ( fs.existsSync( path.join( directories.collections, (pageJson.collection.typeName + ".list") ) ) ) {
                template = (pageJson.collection.typeName + ".list");
                break;
            }

        } else {
            // 0 => Multiple URIs some/fresh/page
            // 1 => Regular Expression tests out
            // 2 => Filename tests out as a .item file
            if ( uriSegs.length > 1 && regcheck.test( tpl ) && rItem.test( tpl ) ) {
                template = tpl;
                break;
            }

            // 0 => A Single URI page
            // 1 => Regular Expression tests out
            // 2 => Filename tests out as a .list file
            if ( uriSegs.length === 1 && regcheck.test( tpl ) && rList.test( tpl ) ) {
                template = tpl;
                break;
            }

            // 1 => Regular Expression tests out
            // 2 => Filename tests out as a .region file
            if ( regcheck.test( tpl ) && rRegions.test( tpl ) ) {
                template = tpl;
                break;
            }
        }
    }

    // 0 => Template not matched above, try page JSON
    if ( !template ) {
        template = "default.region";
    }

    // 0 => Template still didn't match up, fail...
    if ( !template ) {
        functions.log( "TEMPLATE - Not matched:", template );

    } else {
        functions.log( "TEMPLATE - " + template );

        return template;
    }
},


/**
 *
 * @method renderTemplate
 * @param {string} reqUri URI seg zero
 * @param {object} qrs Querystring mapping
 * @param {object} pageJson JSON data for page
 * @param {string} pageHtml HTML for page
 * @param {function} clalback Fired when done
 * @public
 *
 */
renderTemplate = function ( reqUri, qrs, pageJson, pageHtml, callback ) {
    var queries = [],
        template = null,
        rendered = null,
        matched = null,
        region;

    // Template?
    template = getTemplate( reqUri, pageJson );

    // 0.1 => Template is a list or item for a collection
    // 0.2 => The global header and footer vars are null set
    // When not using header or footer region partials, we inject the content into the right layout
    if ( rItemOrList.test( template ) && !header && !footer ) {
        region = ( pageJson.collection.regionName ) ? ( pageJson.collection.regionName + ".region") : "default.region";
        templates[ template ] = templates[ region ].replace( SQS_MAIN_CONTENT, templates[ template ] );
    }

    // Html?
    rendered = templates[ template ];

    // SQS Tags?
    rendered = replaceSQSTags( rendered, pageJson );

    // Queries
    // 0 => Full
    // 1 => Open
    // 2 => Template
    // 3 => Close
    while ( matched = rendered.match( rSQSQuery ) ) {
        rendered = rendered.replace( matched[ 0 ], matched[ 2 ] );

        queries.push( matched );
    }

    function handleDone() {
        // Create {squarespace-headers} / {squarespace-footers}
        setHeaderFooterTokens( pageJson, pageHtml );

        // Render {squarespace-headers} to the best of our ability
        rendered = rendered.replace( SQS_HEADERS, sqsHeaders.join( "" ) );

        // Render {squarespace-footers} to the best of our ability
        rendered = rendered.replace( SQS_FOOTERS, sqsFooters.join( "" ) );

        // Render Navigations from pageHtml
        rendered = replaceNavigations( rendered, pageJson );

        // Render full clickThroughUrl's
        rendered = replaceClickThroughUrls( rendered );

        // Render w/jsontemplate
        rendered = sqsRender.renderJsonTemplate( rendered, pageJson );

        // Add token scripts back into the template
        for ( var i = scripts.length; i--; ) {
            rendered = rendered.replace( scripts[ i ].token, scripts[ i ].script );
        }

        // Render Block Fields
        replaceBlockFields( rendered, function ( finalRender ) {
            callback( finalRender );
        });
    }

    function handleQueried( query, data, json ) {
        var items = [],
            tpl;

        if ( query && data && json ) {
            if ( data.featured ) {
                for ( i = 0, len = json.items.length; i < len; i++ ) {
                    if ( json.items[ i ].starred ) {
                        items.push( json.items[ i ] );
                    }
                }

                json.items = items;
            }

            if ( data.limit ) {
                json.items.splice( 0, (json.items.length - data.limit) );
            }

            tpl = sqsRender.renderJsonTemplate( query[ 2 ], json );

            rendered = rendered.replace( query[ 2 ], tpl );
        }

        if ( queries.length ) {
            sqsRequest.requestQuery( queries.shift(), qrs, pageJson, handleQueried );

        } else {
            handleDone();
        }
    }

    if ( queries.length ) {
        handleQueried();

    } else {
        handleDone();
    }
},


/**
 *
 * @method compileStylesheets
 * @param {function} callback Handle composition done
 * @public
 *
 */
compileStylesheets = function ( callback ) {
    var reset = path.join( directories.styles, "reset.css" ),
        lessCss = "",
        pureCss = "",
        fpath,
        file;

    if ( fs.existsSync( reset ) ) {
        pureCss += functions.readFile( reset );
    }

    for ( var i = 0, len = config.stylesheets.length; i < len; i++ ) {
        fpath = path.join( directories.styles, config.stylesheets[ i ] );

        if ( !fs.existsSync( fpath ) ) {
            continue;
        }

        file = ("" + fs.readFileSync( fpath ));

        if ( rLess.test( config.stylesheets[ i ] ) ) {
            lessCss += file;

        } else {
            pureCss += file;
        }
    }

    less.render( lessCss, function ( error, css ) {
        lessCss = css;
    });

    siteCss = uglifycss.processString( (pureCss + lessCss) );

    return callback;
},


/**
 *
 * @method setSQSHeadersFooters
 * @public
 *
 */
setSQSHeadersFooters = function () {
    sqsHeaders = [];
    sqsFooters = [];
},


/**
 *
 * @method setHeaderFooter
 * @public
 *
 */
setHeaderFooter = function () {
    var files = fs.readdirSync( config.server.webroot );

    for ( i = files.length; i--; ) {
        if ( rRegions.test( files[ i ] ) && rHeader.test( files[ i ] ) ) {
            header = path.join( config.server.webroot, files[ i ] );

        } else if ( rRegions.test( files[ i ] ) && rFooter.test( files[ i ] ) ) {
            footer = path.join( config.server.webroot, files[ i ] );
        }
    }
},


/******************************************************************************
 * @Private
*******************************************************************************/

/**
 *
 * @method setHeaderFooterTokens
 * @param {object} pageJson JSON data for page
 * @param {string} pageHtml HTML for page
 * @returns {string}
 * @private
 *
 */
setHeaderFooterTokens = function ( pageJson, pageHtml ) {
    var tokenHeadersFull = functions.getToken(),
        tokenFootersFull = functions.getToken(),
        sHeadersFull = pageHtml.match( rSQSHeadersFull ),
        sFootersFull = pageHtml.match( rSQSFootersFull ),
        siteStyleTag = null;

    // Headers?
    if ( sHeadersFull ) {
        sHeadersFull = sHeadersFull[ 0 ];
        siteStyleTag = '<!-- ' + config.name + ' Local Styles --><style type="text/css">' + siteCss + '</style>';
        sHeadersFull += siteStyleTag;
        sqsHeaders.push( tokenHeadersFull );
        scripts.push({
            token: tokenHeadersFull,
            script: sHeadersFull
        });
    }

    // Footers?
    if ( sFootersFull ) {
        sqsFooters.push( tokenFootersFull );
        scripts.push({
            token: tokenFootersFull,
            script: sFootersFull[ 0 ]
        });
    }
},


/**
 *
 * @method replaceNavigations
 * @param {string} rendered The template rendering
 * @param {string} pageJson The JSON for the page
 * @returns {string}
 * @private
 *
 */
replaceNavigations = function ( rendered, pageJson ) {
    var context = {
            active: false,
            folderActive: false,
            website: pageJson.website,
            items: []
        },
        block,
        items,
        attrs,
        matched,
        template,
        i,
        iLen,
        j,
        k,
        kLen;

    // SQS Navigations
    matched = rendered.match( rSQSNavis );

    if ( matched ) {
        for ( i = 0, iLen = matched.length; i < iLen; i++ ) {
            attrs = functions.getAttrObj( matched[ i ] );
            block = (attrs.template + ".block");
            template = functions.readFile( path.join( directories.blocks, block ) );

            for ( j = config.server.siteData.siteLayout.layout.length; j--; ) {
                if ( config.server.siteData.siteLayout.layout[ j ].identifier === attrs.navigationId ) {
                    items = [];

                    for ( k = 0, kLen = config.server.siteData.siteLayout.layout[ j ].links.length; k < kLen; k++ ) {
                        if ( config.server.siteData.siteLayout.layout[ j ].links[ k ].collectionId ) {
                            items.push({
                                active: false,
                                folderActive: false,
                                collection: lookupCollection( config.server.siteData.siteLayout.layout[ j ].links[ k ].collectionId )
                            });

                        } else {
                            items.push( config.server.siteData.siteLayout.layout[ j ].links[ k ] );
                        }
                    }

                    context.items = items;
                }
            }

            template = sqsRender.renderJsonTemplate( template, context );

            rendered = rendered.replace( matched[ i ], template );
        }
    }

    return rendered;
},


/**
 *
 * @method replaceClickThroughUrls
 * @param {string} rendered The template rendering
 * @returns {string}
 * @private
 *
 */
replaceClickThroughUrls = function ( rendered ) {
    var matched = rendered.match( rSQSClickThroughUrl ),
        fullUrl;

    if ( matched ) {
        for ( i = 0, len = matched.length; i < len; i++ ) {
            fullUrl = (config.server.siteurl + matched[ i ]);

            rendered = rendered.replace( matched[ i ], fullUrl );
        }
    }

    return rendered;
},


/**
 *
 * @method renderBlockField
 * @param {object} json Block data
 * @param {string} type Block type
 * @private
 *
 */
renderBlockField = function ( json, type ) {
    var html = "";

    type = type.toLowerCase();

    html += '<div class="sqs-block ' + type + '-block sqs-block-' + type + '" data-block-type="' + json.type + '" id="block-' + json.id + '" data-block-json="' + JSON.stringify( json ).replace( /"/g, "&quot;" ) + '">';
    html += '<div class="sqs-block-content">';
    html += blockrenders( json, type );
    html += '</div>';
    html += '</div>';

    return html;
},


/**
 *
 * @method replaceBlockFields
 * @param {string} rendered The template rendering
 * @param {function} callback The callback when done rendering
 * @private
 *
 */
replaceBlockFields = function ( rendered, callback ) {
    var matched;

    // SQS Block Fields
    matched = rendered.match( rSQSBlockFields );

    if ( matched ) {
        sqsRequest.loginPortal( function ( headers ) {
            function loopBlocks( block, attrs, json ) {
                var rows,
                    rLen,
                    html;

                if ( json ) {
                    rows = json.data.layout.rows;
                    rLen = rows.length;
                    html = '<div id="' + attrs.id + '" class="sqs-layout sqs-grid-' + json.data.layout.columns + ' columns-' + json.data.layout.columns + (attrs["locked-layout"] ? ' sqs-locked-layout' : '') + '" data-type="block-field" data-updated-on="' + json.data.updatedOn + '">';

                    // rows > columns > blocks
                    for ( var i = 0; i < rLen; i++ ) {
                        var columns = rows[ i ].columns,
                            cLen = columns.length;

                        html += '<div class="row sqs-row">';

                        for ( var j = 0; j < cLen; j++ ) {
                            var blocks = columns[ j ].blocks,
                                bLen = blocks.length;

                            html += '<div class="col sqs-col-' + (12 / attrs.columns) + ' span-' + columns[ j ].span + '">';

                            for ( var k = 0; k < bLen; k++ ) {
                                for ( var b in blocktypes ) {
                                    if ( blocks[ k ].type === blocktypes[ b ] && blocks[ k ].value.html !== "" ) {
                                        html += renderBlockField( blocks[ k ], b );
                                    }
                                }
                            }

                            html += '</div>';
                        }

                        html += '</div>';
                    }

                    html += '</div>';

                    rendered = rendered.replace( block, html );
                }

                if ( !matched.length ) {
                    callback( rendered );

                } else {
                    getBlock();
                }
            }

            function getBlock() {
                var block = matched.shift(),
                    attrs = functions.getAttrObj( block ),
                    blockPath = path.join( config.server.cacheroot, ("block-" + attrs.id + ".json") ),
                    blockJson;

                if ( fs.existsSync( blockPath ) ) {
                    blockJson = functions.readJson( blockPath );

                    loopBlocks( block, attrs, blockJson );

                    functions.log( "BLOCK - Cached " + attrs.id );

                } else {
                    request({
                        url: (config.server.siteurl + sqsRequest.API_GET_BLOCKFIELDS + attrs.id),
                        json: true,
                        headers: headers,
                        qs: sqsUser

                    }, function ( error, response, json ) {
                        // cache block json
                        // check first, block could be "undefined"
                        if ( json ) {
                            functions.writeJson( blockPath, json );
                        }

                        loopBlocks( block, attrs, json );
                    });
                }
            }

            getBlock();
        });

    } else {
        callback( rendered );
    }
},


/**
 *
 * @method lookupCollection
 * @param {string} id The collection ID
 * @returns {object}
 * @private
 *
 */
lookupCollection = function ( id ) {
    var collection = null;

    for ( var i in config.server.siteData.collections.collections ) {
        if ( i === id ) {
            collection = config.server.siteData.collections.collections[ id ];
            break;
        }
    }

    return collection;
};


/******************************************************************************
 * @Export
*******************************************************************************/
module.exports = {
    setConfig: setConfig,
    setDirs: setDirs,
    setUser: setUser,
    compileCollections: compileCollections,
    compileRegions: compileRegions,
    replaceBlocks: replaceBlocks,
    replaceScripts: replaceScripts,
    replaceSQSScripts: replaceSQSScripts,
    getTemplate: getTemplate,
    renderTemplate: renderTemplate,
    compileStylesheets: compileStylesheets,
    setSQSHeadersFooters: setSQSHeadersFooters,
    setHeaderFooter: setHeaderFooter
};