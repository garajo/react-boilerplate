import React, { Component } from 'react';
import { connect } from 'react-redux';
import * as actions from '../../actions';

class GalleryList extends Component {
    render() {
        return (
            <div>
                <h2 className="text-center">Gallery List</h2>
            </div>
        );
    }
};

function mapStateToProps({ auth }) {
        return { auth };
}

export default connect(mapStateToProps, actions)(GalleryList);