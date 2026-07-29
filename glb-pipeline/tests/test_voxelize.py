from pathlib import Path
from contextlib import redirect_stderr
from io import StringIO
from unittest import TestCase
from unittest.mock import patch

import voxelize


class VoxelizeCliTests(TestCase):
    def test_default_output_is_beside_input(self) -> None:
        source = Path("/tmp/ship.glb")
        self.assertEqual(
            voxelize.output_path_for(source, None, None),
            Path("/tmp/ship.voxel.glb").resolve(),
        )

    def test_output_directory_keeps_stem(self) -> None:
        source = Path("/tmp/ship.glb")
        self.assertEqual(
            voxelize.output_path_for(source, None, Path("/tmp/build")),
            Path("/tmp/build/ship.voxel.glb").resolve(),
        )

    def test_rejects_output_with_multiple_inputs(self) -> None:
        with redirect_stderr(StringIO()), self.assertRaises(SystemExit):
            voxelize.parse_args(["one.glb", "two.glb", "-o", "result.glb"])

    def test_rejects_depth_outside_blender_range(self) -> None:
        with redirect_stderr(StringIO()), self.assertRaises(SystemExit):
            voxelize.parse_args(["one.glb", "--depth", "11"])

    def test_factor_is_an_alias_for_depth(self) -> None:
        args = voxelize.parse_args(["one.glb", "--factor", "7"])
        self.assertEqual(args.depth, 7)

    def test_explicit_blender_is_preferred(self) -> None:
        with patch.object(Path, "is_file", return_value=True):
            self.assertEqual(
                voxelize.find_blender("/opt/blender/blender"),
                "/opt/blender/blender",
            )
