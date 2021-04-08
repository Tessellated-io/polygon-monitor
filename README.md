## Polygon Monitor

This is a simple typescript application to enable monitoring of a Polygon validator node from [Tessellated Geometry](https://tessellatedgeometry.com). 

It checks:
- The amount of ETH on your signing key
- Heimdall block height vs an external API
- Bor block heigh vs an external API
- Your signature is in the latest Heimdall Blocks
- Your signature is in the latest Bor Blocks

If any condition fails, it will send you a page via Pager Duty's API. 

## Setup 

- Install `npm` (or `yarn` if that's your thing).
- Run `npm i` to install dependencies.
- Retrieve your pager duty API token, pager duty service identifier, and pager duty email from [PagerDuty](http://pagerduty.com)
- Modify global variables in `src/monitor.ts` for the specifics of your setup. 
- Run `./start.sh`.

You'll likely need to do a bit of light customization to make this infrastructure suite your exact needs. PRs to generalize the software or extend functionality are welcome. In particular, it would be cool to provide a customizatble remote API.

Feel free to drop us a line on [Keybase](https://keybase.io/tessellatedgeo#_) or at [hello@tessellatedgeometry.com](mailto:hello@tessellatedgeometry.com) if you need help.

# Daemon

A service definition is included. You can modify and deploy the deamon with:
```shell
mv polygon-monitor.service /etc/systemd/system/
systemctl enable polygon-monitor
systemctl start polygon-monitor
```

## Say Thanks

If this software is useful to you please consider [delegating to us](http://tessellatedgeometry.com/).
