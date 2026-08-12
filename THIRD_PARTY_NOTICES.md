# Third-party notices

PanelShelf distributions bundle the following components:

- Node.js, Copyright Node.js contributors, used under the MIT License.
- node-unrar-js, Copyright YuJianrong and contributors, used under the MIT License.
- The UnRAR decompression source included by node-unrar-js is subject to the
  license terms shipped with that component. It is used only to decompress RAR
  archives and is not used to recreate the RAR compression algorithm.
- The small RAR fixture used by the source test suite comes from node-unrar-js's
  MIT-licensed test files.

The complete license texts are included in the installed package under
`licenses/`.

PanelShelf can also query third-party metadata services at runtime after an
explicit user search. Their data and credentials are not bundled with the
package:

- Grand Comics Database metadata is attributed in the application under
  CC BY-SA 4.0. PanelShelf does not reuse GCD cover images.
- Open Library book records are attributed in the application.
- Metron is available only when the NAS owner supplies and authorizes a token.

Provider names and links identify their respective services and do not imply
endorsement. A distributor remains responsible for verifying current provider
terms for its intended use.
