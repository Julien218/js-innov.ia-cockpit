# Avatar Factory Cockpit Module

This module connects the Cockpit to the local Avatar Factory agent on
`127.0.0.1:8791`, the reference uploader on `8792`, and the 3D preview service
on `8793`.

Administrators can upload a mandatory front view and an optional coherent
right view. When both are present, the Cockpit sends `right_reference_path`
and the stable seed `2182026`; the local factory then uses its multiview model.
Every candidate remains blocked on human approval after runtime QA.
