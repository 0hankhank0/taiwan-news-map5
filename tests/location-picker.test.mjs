import assert from "node:assert/strict";
import { LocationPicker, validCoordinates } from "../assets/location-picker.mjs";
class Input { constructor(){this.value="";this.handlers={};} addEventListener(k,fn){this.handlers[k]=fn;} fire(){this.handlers.change();} }
class Map { constructor(){this.handlers={};this.zoom=7;} addControl(){} on(k,fn){this.handlers[k]=fn;} getZoom(){return this.zoom;} flyTo(x){this.lastFly=x;} }
class Marker { constructor(){this.handlers={};} setLngLat(x){this.point={lng:x[0],lat:x[1]};return this;} addTo(){return this;} on(k,fn){this.handlers[k]=fn;return this;} getLngLat(){return this.point;} }
assert.equal(validCoordinates(25.033,121.565),true); assert.equal(validCoordinates("",121.565),false); assert.equal(validCoordinates(121,25),false);
const lat=new Input(), lng=new Input(), status={textContent:""}; globalThis.mapboxgl={Map,Marker,NavigationControl:class{}};
const picker=new LocationPicker({container:{},latInput:lat,lngInput:lng,status,mapboxToken:"token",initial:{lat:25,lng:121}});
picker.map.handlers.click({lngLat:{lat:25.1,lng:121.1}}); assert.equal(lat.value,"25.100000"); assert.equal(lng.value,"121.100000");
picker.marker.point={lat:25.2,lng:121.2}; picker.marker.handlers.dragend(); assert.equal(lat.value,"25.200000");
lat.value="25.3";lng.value="121.3";lat.fire(); assert.deepEqual(picker.marker.point,{lat:25.3,lng:121.3});
delete globalThis.mapboxgl; const fallback={textContent:""}; new LocationPicker({container:{},status:fallback,mapboxToken:""}); assert.match(fallback.textContent,/MAPBOX_ACCESS_TOKEN/);
console.log("location picker tests passed");
