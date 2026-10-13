/* 硬件图鉴 3D 手办视图的模块垫片：静态 import 三个本地 vendor 文件（零 CDN、零 importmap，
   兼容不支持动态 import() 的内嵌 WebView），挂到 window 供 workbench.html 的经典脚本取用。
   workbench.html 里 body3dLoad() 会轮询等待 window.body3dModules 出现。 */
import * as THREE from "./vendor/three.module.min.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { MeshoptDecoder } from "./vendor/meshopt_decoder.module.js";

window.body3dModules = { THREE, GLTFLoader, OrbitControls, MeshoptDecoder };
window.dispatchEvent(new Event("taller-3d-ready"));
