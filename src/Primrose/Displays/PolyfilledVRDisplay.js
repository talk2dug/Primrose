import pliny from "pliny/pliny";

/*
 * Copyright 2015 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import BaseVRDisplay from "./BaseVRDisplay";
import defaultPose from "./defaultPose";
import frameDataFromPose from "./frameDataFromPose";
import { isMobile } from "../../flags";

import {
  mutable,
  immutable,
  FullScreen,
  standardFullScreenBehavior,
  standardExitFullScreenBehavior
} from "../../util";

const defaultLeftBounds = [0, 0, 0.5, 1],
  defaultRightBounds = [0.5, 0, 0.5, 1];

// Start at a higher number to reduce chance of conflict.
let nextDisplayId = 1000,
  hasShowDeprecationWarning = false;

export default class PolyfilledVRDisplay extends BaseVRDisplay {
  constructor(name) {
    super();

    this._currentLayers = [];

    Object.defineProperties(this, {
      capabilities: immutable(Object.defineProperties({}, {
        hasPosition: immutable(false),
        hasOrientation: immutable(isMobile),
        hasExternalDisplay: immutable(false),
        canPresent: immutable(true),
        maxLayers: immutable(1)
      })),
      displayId: immutable(nextDisplayId++),
      displayName: immutable(name),
      isConnected: immutable(true),
      stageParameters: immutable(null),
      isPresenting: immutable(() => FullScreen.isActive ),

      depthNear: mutable(0.01, "number"),
      depthFar: mutable(10000.0, "number"),

      isPolyfilled: immutable(true)
    });

    this._poseData = null;
  }

  getFrameData(frameData) {
    if(!this._poseData){
      this._poseData = this._getPose() || defaultPose();
    }

    frameDataFromPose(frameData, this._poseData, this);
  }

  requestAnimationFrame(callback) {
    return window.requestAnimationFrame(callback);
  }

  cancelAnimationFrame(id) {
    return window.cancelAnimationFrame(id);
  }

  requestPresent(layers) {
    for (var i = 0; i < this.capabilities.maxLayers && i < layers.length; ++i) {
      this._currentLayers[i] = layers[i];
    }
    const elem = layers[0].source;
    return standardFullScreenBehavior(elem);
  }

  exitPresent() {
    this._currentLayers.splice(0);
    return standardExitFullScreenBehavior();
  }

  getLayers() {
    return this._currentLayers.slice();
  }

  submitFrame(pose) {
    this._poseData = null;
  }

};
