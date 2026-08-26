# Avatar Factory Cockpit Module

This module connects the Cockpit to the local Avatar Factory agent on
`127.0.0.1:8791`, the reference uploader on `8792`, and the 3D preview service
on `8793`.

Administrators upload four coherent mandatory views: front, left, back and
right. The Cockpit sends `reference_path`, `left_reference_path`,
`back_reference_path`, `right_reference_path` and the stable seed `2182026`;
the local factory then uses every input of its multiview model. Every candidate
remains blocked on human approval after runtime QA.
