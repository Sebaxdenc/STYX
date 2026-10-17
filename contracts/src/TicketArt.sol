// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title TicketArt
/// @notice Fully on-chain ticket artwork.
///
/// @dev Deliberately on chain rather than on IPFS: the ticket then renders in any
///      wallet the instant it is minted, with no pinning service and nothing to
///      go offline mid-demo. Each ticket is different because the palette and the
///      shapes derive from the holder's own seed, and the artwork CHANGES when a
///      ticket is revoked, so the state is visible in the wallet itself.
library TicketArt {
    using Strings for uint256;

    function render(uint256 tokenId, address holder, string memory stateLabel, bool alive)
        internal
        pure
        returns (string memory)
    {
        uint256 seed = uint256(keccak256(abi.encodePacked(tokenId, holder)));
        string memory svg = _svg(seed, tokenId, stateLabel, alive);

        string memory json = string.concat(
            '{"name":"STYX Ticket #',
            tokenId.toString(),
            '","description":"Entrada STYX. El control esta en la redencion, no en la transferencia: ',
            "vender la wallet no transfiere la admision.",
            '","attributes":[{"trait_type":"Estado","value":"',
            stateLabel,
            '"}],"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '"}'
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _svg(uint256 seed, uint256 tokenId, string memory stateLabel, bool alive)
        private
        pure
        returns (string memory)
    {
        string memory hueA = (seed % 360).toString();
        string memory hueB = ((seed >> 16) % 360).toString();

        // Un dibujo apagado y tachado cuando la entrada ya no vale.
        string memory saturation = alive ? "70%" : "6%";
        string memory accent = alive ? string.concat("hsl(", hueB, ",80%,62%)") : "#8b1a1a";

        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 460">',
            "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>",
            "<stop offset='0' stop-color='hsl(",
            hueA,
            ",",
            saturation,
            ",18%)'/>",
            "<stop offset='1' stop-color='hsl(",
            hueB,
            ",",
            saturation,
            ",6%)'/>",
            "</linearGradient></defs>",
            "<rect width='320' height='460' fill='url(#g)'/>",
            _shapes(seed, accent, alive),
            _text(tokenId, stateLabel, accent),
            alive
                ? ""
                : "<line x1='30' y1='40' x2='290' y2='420' stroke='#8b1a1a' stroke-width='10'/>",
            "</svg>"
        );
    }

    function _shapes(uint256 seed, string memory accent, bool alive)
        private
        pure
        returns (string memory out)
    {
        // Seis formas derivadas de la semilla: cada entrada sale distinta sin
        // necesidad de almacenar nada.
        for (uint256 i = 0; i < 6; i++) {
            uint256 s = uint256(keccak256(abi.encodePacked(seed, i)));
            string memory cx = (30 + (s % 260)).toString();
            string memory cy = (60 + ((s >> 8) % 300)).toString();
            string memory r = (14 + ((s >> 16) % 46)).toString();
            out = string.concat(
                out,
                "<circle cx='",
                cx,
                "' cy='",
                cy,
                "' r='",
                r,
                "' fill='none' stroke='",
                accent,
                "' stroke-width='2' opacity='",
                alive ? "0.55" : "0.2",
                "'/>"
            );
        }
    }

    function _text(uint256 tokenId, string memory stateLabel, string memory accent)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            "<text x='24' y='52' font-family='monospace' font-size='26' fill='#f5f5f5'>STYX</text>",
            "<text x='24' y='74' font-family='monospace' font-size='11' fill='",
            accent,
            "'>FAIR ALLOTMENT PROTOCOL</text>",
            "<text x='24' y='400' font-family='monospace' font-size='15' fill='#f5f5f5'>#",
            tokenId.toString(),
            "</text>",
            "<text x='24' y='422' font-family='monospace' font-size='12' fill='",
            accent,
            "'>",
            stateLabel,
            "</text>",
            "<text x='24' y='440' font-family='monospace' font-size='10' fill='#9a9a9a'>",
            "redencion ligada a identidad",
            "</text>"
        );
    }
}
