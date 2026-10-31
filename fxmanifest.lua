fx_version 'cerulean'
game 'gta5'
lua54 'yes'
node_version '22'

name 'fivecord'
author 'IamZach'
discord 'https://discord.gg/agn'
description 'Run your FiveM server from Discord'
version '1.2.1'
repository 'https://github.com/1amZach/fivecord'

server_scripts {
    'config.lua',
    'server/bridge.lua',
    'dist/server.js',
}

client_scripts {
    '@ox_lib/init.lua',
    'client/main.lua',
}

dependency 'ox_lib'
